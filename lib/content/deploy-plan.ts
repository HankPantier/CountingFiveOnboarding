// ---------------------------------------------------------------------------
// Re-deploy safety for the packaged deliverable. The first push of a package to
// a site's draft branch is a plain overlay (nothing on the branch is ours to
// protect yet). Every LATER push must not silently revert what operators, the
// editor, Theme Studio or the Design Studio changed on draft since:
//
//   - site config (brand/design/nav/blog/client-center + the theme files:
//     src/styles/theme.css and, on T1+ templates, src/app/fonts.generated.ts)
//     is never overwritten once it exists on draft — only created when absent;
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
import {
  blogPathFromJson,
  liveRedirectWarnings,
  pageUrlsFromPaths,
  parseRedirectRows,
  type LiveRedirectWarning,
  redirectKey,
  resolveRedirectTarget,
  sanitizeRedirectsCsv,
} from '@/lib/editor/redirects'

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
  // FONTS_MODULE_PATH (lib/design/drift.ts). A literal, not an import: this
  // module is imported by client components and must not drag in the theme
  // generators drift.ts pulls in. deploy-plan.test.ts asserts they're equal.
  'src/app/fonts.generated.ts',
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
  /**
   * redirects.csv rows whose source still has a real page after this push
   * (the redirect shadows it). Kept, never removed automatically — reported
   * to the operator with the redirect-map issues.
   */
  redirectWarnings: LiveRedirectWarning[]
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
//
// The result is always loop-free (lib/editor/redirects.ts): a generated X→A
// whose A is already redirected is collapsed to the end of that chain, a
// generated row that would close a loop is dropped, and any loop or
// self-redirect already on draft is broken, which is what heals the loops
// already on live sites at their next deploy. Rows over live pages are kept
// and reported (planDeployPush's redirectWarnings).
export function mergeRedirectsCsv(
  draft: string,
  generated: string,
  lastDeployed: string | null
): string {
  // Chains resolve against a loop-free copy, so a loop on draft never becomes a target.
  const loopFree = sanitizeRedirectsCsv(draft)
  // Compared by redirectKey, so a draft `/a/` row (normalized to `/a` below)
  // still counts as the same source as a generated `/a`.
  const existingFrom = new Set(draft.split('\n').filter(isDataRow).map((l) => redirectKey(firstCsvField(l))))
  const previouslyShipped = new Set(
    (lastDeployed ?? '').split('\n').filter(isDataRow).map((l) => redirectKey(firstCsvField(l)))
  )
  const additions = generated
    .split('\n')
    .filter(isDataRow)
    .filter((line) => {
      const from = redirectKey(firstCsvField(line))
      return !existingFrom.has(from) && !previouslyShipped.has(from)
    })
    .flatMap((line) => {
      const [row] = parseRedirectRows(line.trim())
      if (!row) return [line.trim()]
      const target = resolveRedirectTarget(loopFree, row.to)
      if (redirectKey(target) === redirectKey(row.from)) return []
      if (target === row.to) return [line.trim()]
      return [[row.from, target, row.status || '301', row.reason].map(csvField).join(',')]
    })
  const base = draft.length === 0 || draft.endsWith('\n') ? draft : draft + '\n'
  const merged = additions.length === 0 ? draft : base + additions.join('\n') + '\n'
  const safe = sanitizeRedirectsCsv(merged)
  // sanitize normalizes a missing final newline; don't churn the file for that.
  return safe === merged || safe === merged + '\n' ? merged : safe
}

function asText(content: string | Buffer): string {
  return typeof content === 'string' ? content : content.toString('utf-8')
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// Urls of every published page the deployed site will have: the POST-push
// tree, i.e. what is already on draft plus the entries this plan actually
// pushes. A package entry the plan skips (e.g. a page the editor moved away,
// skipped as 'removed') is NOT live, so a fresh editor-move 301 away from its
// old url survives the re-deploy.
// Posts count under the site's blog path: the draft's content/blog.json (site
// config, so draft wins), else the one this package ships, else /resources.
function livePageUrls(
  draftBlobs: ReadonlyMap<string, string>,
  pushedPaths: Iterable<string>,
  input: PlanInput
): Set<string> {
  const shipped = input.entries.find((e) => e.path === BLOG_JSON_PATH)
  const blogJson = input.blogJson ?? (shipped ? asText(shipped.content) : null)
  return pageUrlsFromPaths([...draftBlobs.keys(), ...pushedPaths], blogPathFromJson(blogJson))
}

const BLOG_JSON_PATH = 'content/blog.json'

export type PlanInput = {
  entries: { path: string; content: string | Buffer }[]
  /** path → blob sha on the draft tip (blobs only). */
  draftBlobs: ReadonlyMap<string, string>
  /** path → blob sha the pipeline last wrote; null = no earlier deploy found. */
  baseline: Readonly<Record<string, string>> | null
  /** Current draft + last-deployed redirects.csv text (re-deploy only). */
  redirects?: { draft: string | null; lastDeployed: string | null }
  /** The draft's content/blog.json text, when it has one (posts' base path). */
  blogJson?: string | null
}

export function planDeployPush(input: PlanInput): DeployPlan {
  const { entries, draftBlobs, baseline } = input
  const manifestGuard = draftBlobs.get(DEPLOY_MANIFEST_PATH) ?? null

  if (baseline === null) {
    // First deploy: a plain overlay, so every entry is pushed.
    const live = livePageUrls(draftBlobs, entries.map((e) => e.path), input)
    const safeEntries = entries.map((e) =>
      e.path === REDIRECTS_CSV_PATH ? { ...e, content: sanitizeRedirectsCsv(asText(e.content)) } : e
    )
    const shipped = safeEntries.find((e) => e.path === REDIRECTS_CSV_PATH)
    const blobs: Record<string, string> = {}
    for (const e of safeEntries) blobs[e.path] = gitBlobSha(e.content)
    return {
      firstDeploy: true,
      push: [
        ...safeEntries,
        { path: DEPLOY_MANIFEST_PATH, content: serializeDeployManifest(blobs), expectedBlobSha: manifestGuard },
      ],
      skipped: [],
      redirectWarnings: shipped ? liveRedirectWarnings(asText(shipped.content), { livePaths: live }) : [],
    }
  }

  // Carry forward what we knew about paths this package no longer ships.
  const nextManifest: Record<string, string> = { ...baseline }
  const push: PushEntry[] = []
  const skipped: SkippedFile[] = []

  for (const e of entries) {
    // redirects.csv is planned after the loop, once the pushed set is known.
    if (e.path === REDIRECTS_CSV_PATH) continue
    const draft = draftBlobs.get(e.path) ?? null
    const base = baseline[e.path] ?? null

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

  let redirectWarnings: LiveRedirectWarning[] = []
  const redirectsEntry = entries.find((e) => e.path === REDIRECTS_CSV_PATH)
  if (redirectsEntry) {
    const path = REDIRECTS_CSV_PATH
    const draft = draftBlobs.get(path) ?? null
    const live = livePageUrls(draftBlobs, push.map((p) => p.path), input)
    const generated = sanitizeRedirectsCsv(asText(redirectsEntry.content))
    const current = input.redirects?.draft ?? null
    let final: string | null = null
    if (draft === null) {
      push.push({ path, content: generated, expectedBlobSha: null })
      nextManifest[path] = gitBlobSha(generated)
      final = generated
    } else if (current === null) {
      // Couldn't read the draft copy — leave it alone rather than guess.
      skipped.push({ path, reason: 'edited' })
    } else {
      const merged = mergeRedirectsCsv(current, generated, input.redirects?.lastDeployed ?? null)
      if (merged !== current) push.push({ path, content: merged, expectedBlobSha: draft })
      nextManifest[path] = gitBlobSha(merged)
      final = merged
    }
    if (final !== null) redirectWarnings = liveRedirectWarnings(final, { livePaths: live })
  }

  push.push({
    path: DEPLOY_MANIFEST_PATH,
    content: serializeDeployManifest(nextManifest),
    expectedBlobSha: manifestGuard,
  })
  return { firstDeploy: false, push, skipped, redirectWarnings }
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
