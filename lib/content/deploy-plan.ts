// ---------------------------------------------------------------------------
// Re-deploy safety for the packaged deliverable. The first push of a package to
// a site's draft branch is a plain overlay (nothing on the branch is ours to
// protect yet). Every LATER push must not silently revert what operators, the
// editor, Theme Studio or the Design Studio changed on draft since:
//
//   - site config (brand/design/nav/blog/client-center + the theme files) is
//     never overwritten once it exists on draft — only created when absent;
//   - redirects.csv is MERGED (new generated rows appended; editor-added 301s
//     and rows an operator deliberately removed are left alone);
//   - every other generated file is pushed only when its current draft blob is
//     still the blob the pipeline last wrote (per-entry expectedBlobSha), or the
//     path is absent on both sides. Anything else is skipped and reported.
//
// "The blob the pipeline last wrote" comes from a small manifest committed with
// every deploy (DEPLOY_MANIFEST_PATH). Sites deployed before the manifest
// existed fall back to the tree of their last "Deploy packaged content" commit —
// those legacy pushes were unguarded overlays, so that tree is exactly what the
// pipeline generated. This module is pure: callers load the branch state.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto'
import type { PushEntry } from '@/lib/github/repo-files'
import { DEPLOY_MANIFEST_PATH } from '@/lib/github/deploy-commit'

export { DEPLOY_MANIFEST_PATH }
export const REDIRECTS_CSV_PATH = 'content/redirects.csv'

// Files owned by the site's settings surfaces once the site exists. Only the
// first deploy writes them over whatever the template shipped.
export const SITE_CONFIG_PATHS: ReadonlySet<string> = new Set([
  'content/brand.json',
  'content/design.json',
  'content/nav.json',
  'content/blog.json',
  'content/client-center.json',
  'content/design-overrides.css',
  'src/styles/theme.css',
])

export type SkipReason =
  /** Site config that already exists on draft (never overwritten after the first deploy). */
  | 'site-config'
  /** Edited on draft since the last package. */
  | 'edited'
  /** Removed or moved on draft since the last package. */
  | 'removed'
  /** Created on draft by someone else at a path the package now wants. */
  | 'created'

export type SkippedFile = { path: string; reason: SkipReason }

export type DeployManifest = {
  version: 1
  /** path → the git blob sha the pipeline last wrote there. */
  blobs: Record<string, string>
}

export type DeployPlan = {
  /** True when no earlier deploy was found — behaves like the original overlay. */
  firstDeploy: boolean
  /** Entries to commit (includes the manifest). */
  push: PushEntry[]
  skipped: SkippedFile[]
}

// Git's blob object id for some content: sha1("blob <len>\0" + bytes). Equal to
// what createBlob returns, so a generated file can be compared to a tree entry
// without uploading it.
export function gitBlobSha(content: string | Buffer): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  return createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex')
}

// Paths a package can ship: content/pages/**, top-level content/ files, and
// public/**. Posts, drafts and anything outside content/ + public/ are written
// by other features, so a legacy (pre-manifest) baseline is limited to these.
export function isPackageOwnedPath(path: string): boolean {
  if (path.startsWith('public/')) return true
  if (path.startsWith('content/pages/')) return true
  return /^content\/[^/]+$/.test(path)
}

export function parseDeployManifest(text: string): DeployManifest | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const blobs = (parsed as { blobs?: unknown }).blobs
    if (!blobs || typeof blobs !== 'object' || Array.isArray(blobs)) return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(blobs as Record<string, unknown>)) {
      if (typeof v === 'string' && /^[0-9a-f]{40}$/.test(v)) out[k] = v
    }
    return { version: 1, blobs: out }
  } catch {
    return null
  }
}

export function serializeDeployManifest(blobs: Record<string, string>): string {
  const sorted: Record<string, string> = {}
  for (const k of Object.keys(blobs).sort()) sorted[k] = blobs[k]
  return JSON.stringify({ version: 1, blobs: sorted }, null, 2) + '\n'
}

// First CSV field of a redirects row (old_url), unquoting a "quoted" value.
function firstCsvField(line: string): string {
  const t = line.trim()
  if (t.startsWith('"')) {
    let out = ''
    for (let i = 1; i < t.length; i++) {
      const c = t[i]
      if (c === '"') {
        if (t[i + 1] === '"') { out += '"'; i++; continue }
        return out
      }
      out += c
    }
    return out
  }
  const comma = t.indexOf(',')
  return comma < 0 ? t : t.slice(0, comma)
}

function isDataRow(line: string): boolean {
  const t = line.trim()
  if (!t || t.startsWith('#')) return false
  return firstCsvField(t) !== 'old_url'
}

// Merge freshly generated redirect rows into the draft's redirects.csv: keep
// every existing line verbatim, append generated rows whose old_url isn't
// already redirected. A row that was in the last-deployed file but is gone from
// draft was removed on purpose — it is not re-added.
export function mergeRedirectsCsv(
  draft: string,
  generated: string,
  lastDeployed: string | null
): string {
  const existingFrom = new Set(draft.split('\n').filter(isDataRow).map(firstCsvField))
  const previouslyShipped = new Set(
    (lastDeployed ?? '').split('\n').filter(isDataRow).map(firstCsvField)
  )
  const additions = generated
    .split('\n')
    .filter(isDataRow)
    .filter((line) => {
      const from = firstCsvField(line)
      return !existingFrom.has(from) && !previouslyShipped.has(from)
    })
  if (additions.length === 0) return draft
  const base = draft.length === 0 || draft.endsWith('\n') ? draft : draft + '\n'
  return base + additions.map((l) => l.trim()).join('\n') + '\n'
}

export type PlanInput = {
  entries: { path: string; content: string | Buffer }[]
  /** path → blob sha on the draft tip (blobs only). */
  draftBlobs: ReadonlyMap<string, string>
  /** path → blob sha the pipeline last wrote; null = no earlier deploy found. */
  baseline: Readonly<Record<string, string>> | null
  /** Current draft + last-deployed redirects.csv text (re-deploy only). */
  redirects?: { draft: string | null; lastDeployed: string | null }
}

export function planDeployPush(input: PlanInput): DeployPlan {
  const { entries, draftBlobs, baseline } = input
  const manifestGuard = draftBlobs.get(DEPLOY_MANIFEST_PATH) ?? null

  if (baseline === null) {
    const blobs: Record<string, string> = {}
    for (const e of entries) blobs[e.path] = gitBlobSha(e.content)
    return {
      firstDeploy: true,
      push: [
        ...entries,
        { path: DEPLOY_MANIFEST_PATH, content: serializeDeployManifest(blobs), expectedBlobSha: manifestGuard },
      ],
      skipped: [],
    }
  }

  // Carry forward what we knew about paths this package no longer ships.
  const nextManifest: Record<string, string> = { ...baseline }
  const push: PushEntry[] = []
  const skipped: SkippedFile[] = []

  for (const e of entries) {
    const draft = draftBlobs.get(e.path) ?? null
    const base = baseline[e.path] ?? null

    if (e.path === REDIRECTS_CSV_PATH) {
      const generated = typeof e.content === 'string' ? e.content : e.content.toString('utf-8')
      if (draft === null) {
        push.push({ path: e.path, content: generated, expectedBlobSha: null })
        nextManifest[e.path] = gitBlobSha(generated)
        continue
      }
      const current = input.redirects?.draft ?? null
      if (current === null) {
        // Couldn't read the draft copy — leave it alone rather than guess.
        skipped.push({ path: e.path, reason: 'edited' })
        continue
      }
      const merged = mergeRedirectsCsv(current, generated, input.redirects?.lastDeployed ?? null)
      if (merged !== current) push.push({ path: e.path, content: merged, expectedBlobSha: draft })
      nextManifest[e.path] = gitBlobSha(merged)
      continue
    }

    const sha = gitBlobSha(e.content)

    if (SITE_CONFIG_PATHS.has(e.path)) {
      if (draft === null) {
        push.push({ path: e.path, content: e.content, expectedBlobSha: null })
        nextManifest[e.path] = sha
      } else if (draft !== sha) {
        skipped.push({ path: e.path, reason: 'site-config' })
      }
      continue
    }

    if (draft === sha) {
      // Already identical on draft — nothing to write.
      nextManifest[e.path] = sha
      continue
    }
    if (draft === null && base === null) {
      push.push({ path: e.path, content: e.content, expectedBlobSha: null })
      nextManifest[e.path] = sha
      continue
    }
    if (draft !== null && draft === base) {
      push.push({ path: e.path, content: e.content, expectedBlobSha: draft })
      nextManifest[e.path] = sha
      continue
    }
    skipped.push({
      path: e.path,
      reason: draft === null ? 'removed' : base === null ? 'created' : 'edited',
    })
  }

  push.push({
    path: DEPLOY_MANIFEST_PATH,
    content: serializeDeployManifest(nextManifest),
    expectedBlobSha: manifestGuard,
  })
  return { firstDeploy: false, push, skipped }
}

// What a re-deploy would keep as-is, computable WITHOUT assembling the package
// (for the "before" notice): existing site config, plus every file the
// pipeline last wrote that has since been edited or removed on draft.
export function previewPreservedFiles(
  draftBlobs: ReadonlyMap<string, string>,
  baseline: Readonly<Record<string, string>> | null
): SkippedFile[] {
  if (baseline === null) return []
  const out: SkippedFile[] = []
  for (const p of SITE_CONFIG_PATHS) {
    if (draftBlobs.has(p)) out.push({ path: p, reason: 'site-config' })
  }
  for (const [path, base] of Object.entries(baseline)) {
    if (SITE_CONFIG_PATHS.has(path) || path === REDIRECTS_CSV_PATH) continue
    const draft = draftBlobs.get(path) ?? null
    if (draft === base) continue
    out.push({ path, reason: draft === null ? 'removed' : 'edited' })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
