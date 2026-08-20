import {
  listTree,
  readFile,
  readBinaryFile,
  pushEntriesToBranch,
  syncMainIntoDraft,
  FileNotFoundError,
  MAIN_BRANCH,
  type TreeEntry,
} from '@/lib/github/repo-files'
import { withRateLimitRetry } from '@/lib/github/rate-limit'
import { resolveTemplateSlug } from '@/lib/github/template-seed'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { isManaged, isFlagged, selectManagedPaths } from './manifest'
import {
  SYNC_BRANCH,
  resetSyncBranchToMain,
  compareSyncToMain,
  mergeSyncToMain,
  revertLastFleetPublish,
  type BranchCompare,
  type FleetMergeResult,
  type FleetRevertResult,
} from './git'
import type { ClientEntry, Manifest, RolloutPlan } from './types'

const BRAND_PATH = 'content/brand.json'
const DESIGN_PATH = 'content/design.json'
const THEME_CSS_PATH = 'src/styles/theme.css'
const TEMPLATE_MARKER_PREFIX = 'src/components/'

// Binary blob extensions in the managed set (fonts/icons that live under a
// synced dir). Images proper live under public/** (excluded), so this is rare.
const BINARY_EXT_RE = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|eot)$/i

const READ_CONCURRENCY = 5

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export interface TemplatePayload {
  templateSlug: string
  /** Managed files read from template@main, ready to overlay onto a client. */
  entries: { path: string; content: string | Buffer }[]
  /** Managed path → template blob sha, for plan/diffing. */
  shaByPath: Map<string, string>
  /** flagIfChanged path → template blob sha (not synced; surfaced by plan). */
  flaggedShaByPath: Map<string, string>
}

// Read the template's managed files ONCE — they're identical for every client,
// so a fleet run reads them a single time and overlays the same payload onto
// each target (only theme.css is regenerated per-client).
export async function collectTemplatePayload(manifest: Manifest): Promise<TemplatePayload> {
  const templateSlug = resolveTemplateSlug()
  const tree = await listTree(templateSlug, MAIN_BRANCH)
  const managed = selectManagedPaths(tree, manifest)

  const entries = await mapWithConcurrency(managed, READ_CONCURRENCY, async (path) => {
    if (BINARY_EXT_RE.test(path)) {
      const blob = await withRateLimitRetry(() => readBinaryFile(templateSlug, path, MAIN_BRANCH))
      return { path, content: blob.content as Buffer }
    }
    const blob = await withRateLimitRetry(() => readFile(templateSlug, path, MAIN_BRANCH))
    return { path, content: blob.content as string }
  })

  const shaByPath = new Map<string, string>()
  for (const n of tree) if (isManaged(n.path, manifest)) shaByPath.set(n.path, n.sha)

  const flaggedShaByPath = new Map<string, string>()
  for (const n of tree) if (n.type === 'blob' && isFlagged(n.path, manifest)) flaggedShaByPath.set(n.path, n.sha)

  return { templateSlug, entries, shaByPath, flaggedShaByPath }
}

function shaMap(tree: TreeEntry[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of tree) if (n.type === 'blob') m.set(n.path, n.sha)
  return m
}

// Diff the template's managed set against one client's live (main) tree.
// No writes — the dry-run behind `fleet-rollout plan`.
export async function planRollout(
  client: ClientEntry,
  manifest: Manifest,
  payload: TemplatePayload
): Promise<RolloutPlan> {
  const clientTree = await listTree(client.slug, MAIN_BRANCH)
  const clientSha = shaMap(clientTree)
  const notATemplateSite = !clientTree.some((n) => n.path.startsWith(TEMPLATE_MARKER_PREFIX))

  const adds: string[] = []
  const updates: string[] = []
  const unchanged: string[] = []
  for (const [path, tSha] of payload.shaByPath) {
    const cSha = clientSha.get(path)
    if (cSha === undefined) adds.push(path)
    else if (cSha !== tSha) updates.push(path)
    else unchanged.push(path)
  }

  const flagged: string[] = []
  for (const [path, tSha] of payload.flaggedShaByPath) {
    const cSha = clientSha.get(path)
    if (cSha !== undefined && cSha !== tSha) flagged.push(path)
  }

  return {
    slug: client.slug,
    displayName: client.displayName,
    adds: adds.sort(),
    updates: updates.sort(),
    unchanged: unchanged.sort(),
    flagged: flagged.sort(),
    notATemplateSite,
  }
}

export interface StageResult {
  slug: string
  commitSha: string
  fileCount: number
  themeRegenerated: boolean
  warnings: string[]
}

// Regenerate the client's theme.css from THEIR palette using the (possibly
// updated) generator logic. Returns null + a warning when brand/design are
// absent (unassembled client), so a stage never fails on a missing file.
async function regenerateTheme(slug: string, warnings: string[]): Promise<string | null> {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse((await readFile(slug, BRAND_PATH, MAIN_BRANCH)).content) as BrandJson
    design = JSON.parse((await readFile(slug, DESIGN_PATH, MAIN_BRANCH)).content) as DesignJson
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      warnings.push(`theme.css not regenerated — ${err.message} (client not assembled?)`)
      return null
    }
    throw err
  }
  return generateThemeCss(brand, design)
}

// Stage the rollout onto one client: reset template-sync to their live tree,
// overlay the template's managed files, regenerate theme.css, and commit — all
// on the non-live template-sync branch. Vercel builds the branch preview.
export async function stageClient(
  client: ClientEntry,
  payload: TemplatePayload,
  author: { name: string; email: string }
): Promise<StageResult> {
  const warnings: string[] = []

  const clientTree = await listTree(client.slug, MAIN_BRANCH)
  if (!clientTree.some((n) => n.path.startsWith(TEMPLATE_MARKER_PREFIX))) {
    throw new Error(
      `${client.slug} does not look like a template site (no ${TEMPLATE_MARKER_PREFIX}); refusing to stage.`
    )
  }

  await resetSyncBranchToMain(client.slug)

  const entries: { path: string; content: string | Buffer }[] = [...payload.entries]
  const themeCss = await regenerateTheme(client.slug, warnings)
  const themeRegenerated = themeCss !== null
  if (themeCss !== null) entries.push({ path: THEME_CSS_PATH, content: themeCss })

  const push = await pushEntriesToBranch(
    client.slug,
    SYNC_BRANCH,
    entries,
    `Fleet rollout: sync template-managed files${themeRegenerated ? ' + regenerate theme.css' : ''}`,
    { authorName: author.name, authorEmail: author.email }
  )

  return {
    slug: client.slug,
    commitSha: push.commitSha,
    fileCount: push.fileCount,
    themeRegenerated,
    warnings,
  }
}

export interface RolloutStatus {
  slug: string
  displayName: string
  compare: BranchCompare
  /** Best-guess Vercel preview host for the staged branch (verify build there before promoting). */
  previewHint: string
}

export async function rolloutStatus(client: ClientEntry): Promise<RolloutStatus> {
  const compare = await compareSyncToMain(client.slug)
  const repo = client.slug.includes('/') ? client.slug.split('/')[1] : client.slug
  return {
    slug: client.slug,
    displayName: client.displayName,
    compare,
    previewHint: `${repo}-git-${SYNC_BRANCH}-<team>.vercel.app`,
  }
}

export interface PromoteResult {
  slug: string
  merge: FleetMergeResult
  draftSynced: boolean
  warnings: string[]
}

// Promote a staged client to live: merge template-sync → main, then pull the new
// main into the editor's draft so a later content publish doesn't conflict.
// Caller is responsible for having confirmed the branch preview build is green.
export async function promoteClient(client: ClientEntry): Promise<PromoteResult> {
  const warnings: string[] = []
  const merge = await mergeSyncToMain(client.slug)
  let draftSynced = false
  if (merge.merged) {
    try {
      const sync = await syncMainIntoDraft(client.slug)
      draftSynced = sync.synced
      if (!sync.synced) warnings.push(`draft not auto-synced: ${sync.reason}`)
    } catch (err) {
      warnings.push(`draft sync errored: ${(err as Error).message}`)
    }
  }
  return { slug: client.slug, merge, draftSynced, warnings }
}

export async function rollbackClient(client: ClientEntry): Promise<FleetRevertResult> {
  return revertLastFleetPublish(client.slug)
}
