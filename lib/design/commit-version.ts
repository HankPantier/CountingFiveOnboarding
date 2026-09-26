// Server-only (apply-bundle / bundle-files → lightningcss). THE single path
// that turns a DesignBundle into a draft commit + a design_versions row —
// shared by concept apply (P3), chat commits and version restore (P5):
//   1. the base theme: without expectedShas, the draft snapshot; with it, the
//      files AT those blob shas (immutable — no lagging branch read). brand /
//      design are required → 409
//   2. capability tier (fonts locked below L2 → 422)
//   3. applyBundleToDraft — re-sanitizes CSS, hard-gates checkThemeContrast,
//      one atomic commit guarded by expected blob shas (StaleShaError → 409
//      stale). With expectedShas the base is handed to it and EVERY base file
//      is guarded; that guard is the ONLY staleness check (no pre-comparison
//      against a snapshot, which can still show the pre-commit tip right after
//      a commit and would false-409 a chat turn's second commit).
//   4. syncMbpTheme (palette → brand.primaryColors, fonts → brand.typography),
//      only when `syncMbp` — human-clicked commits (concept apply, restore)
//      pass true; chat commits pass false (CLAUDE.md: an interactive AI
//      session never silently mutates schema_data). A chat-made design reaches
//      the MBP through the Versions panel's human-clicked "Sync palette &
//      fonts to MBP" (POST design/sync-mbp), which mirrors the whole draft.
//   5. the FULL post-apply four-file blob map (the applied_blobs contract)
//   6. insertVersion (version_no = max + 1, 23505 retry)
// Render gates are the CALLER's job (concept: its stored review metrics; chat:
// the turn's latest preview; restore: none — the version was on the draft
// before). Unexpected errors (GitHub, network) are rethrown for internalError.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { StaleShaError } from '@/lib/github/repo-files'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { BRAND_PATH, DESIGN_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { applyBundleToDraft } from './apply-bundle'
import type { DesignBundle } from './bundle'
import { bundleFromRepoFiles, hasLegacyOverrides } from './bundle-files'
import { capabilityViolations } from './capabilities'
import { readDesignCapabilities } from './capabilities-read'
import { mergeAppliedBlobs } from './drift'
import type { RunScreenshot } from './run-types'
import { hasAnyVersion, insertVersion, VersionConflictError, type DesignVersionRow } from './store'
import type { ThemeBlobShas } from './studio-types'
import { syncMbpTheme } from './sync-mbp-theme'
import { readDraftThemeSnapshot, readThemeSnapshotAt, themeTextsFromSnapshot } from './theme-snapshot'

type Db = SupabaseClient<Database>

export const STALE_THEME_ERROR = 'The theme changed while applying — refresh the Studio and try again.'
export const APPLIED_VERSION_NUMBER_UNRECORDED = 'The design was applied to the draft, but its version number could not be recorded — refresh the Studio.'
export const APPLIED_VERSION_UNRECORDED = 'The design was applied to the draft, but its version could not be recorded — refresh the Studio.'
export const NO_BASELINE_ERROR =
  'The Studio has no v0 baseline of this site yet (importing the current design failed), so nothing can be committed — the first commit would otherwise become v0 and the original design could never be restored. Fix the draft theme files (Controls tab or the file editor), then Refresh.'
export const LEGACY_KEEP_UNCHECKED_ERROR =
  'This concept was render-checked with the legacy overrides removed. Keeping them was never checked against the new palette, so it can’t be applied that way — apply with “Remove legacy overrides” on, or apply it and then refine in the chat (whose previews keep them).'

export type CommitTarget = { sessionId: string; jobId: string; githubRepo: string; adminId: string; adminEmail?: string; adminName?: string }

export type CommitVersionArgs = {
  target: CommitTarget
  bundle: DesignBundle
  source: 'concept' | 'chat' | 'revert'
  removeLegacy: boolean
  // Mirror the applied palette/fonts into schema_data. true for human-clicked
  // commits (concept apply, restore); false for chat commits.
  syncMbp: boolean
  summary: string
  commitMessage: string
  conceptId?: string | null
  screenshots?: RunScreenshot[]
  // The theme blobs the caller built on (turn start, or its last commit's
  // appliedBlobs). Becomes the apply base + its sha guard — see the header.
  expectedShas?: ThemeBlobShas
  skipIfUnchanged?: boolean
  // The caller's render gate measured the composition WITH legacy hand CSS
  // removed (concept apply). When the commit keeps it (removeLegacy false) and
  // the draft actually has some, what would be written was never rendered —
  // refuse (422) instead of committing an unchecked composition.
  gateRenderedWithoutLegacy?: boolean
  // Restore only: the exact design-overrides.css to write (see applyBundleToDraft).
  overridesVerbatim?: string
}

export type CommitVersionResult =
  | { ok: true; version: DesignVersionRow | null; commitSha: string | null; changedPaths: string[]; appliedBlobs: ThemeBlobShas; css: DesignBundle['css'] }
  | { ok: false; status: 409 | 422; error: string; stale?: true }

export async function commitDesignVersion(db: Db, args: CommitVersionArgs): Promise<CommitVersionResult> {
  const { target, bundle, expectedShas } = args
  // v0 must record the ORIGINAL design. If its import failed (e.g. an
  // uncurated font), refuse rather than let this commit become v0.
  if (!(await hasAnyVersion(db, target.sessionId))) return { ok: false, status: 409, error: NO_BASELINE_ERROR }
  const before = expectedShas
    ? await readThemeSnapshotAt(target.githubRepo, expectedShas)
    : await readDraftThemeSnapshot(target.githubRepo)
  const draft = themeTextsFromSnapshot(before)
  if (!draft.ok) return { ok: false, status: 409, error: draft.error }
  if (args.gateRenderedWithoutLegacy && !args.removeLegacy && hasLegacyOverrides(draft.files.overridesCss)) {
    return { ok: false, status: 422, error: LEGACY_KEEP_UNCHECKED_ERROR }
  }

  // Only the fonts matter for the capability check, so the overrides file
  // (and any malformed region in it) is irrelevant here.
  const current = bundleFromRepoFiles(
    { brandText: draft.files.brandText, designText: draft.files.designText, overridesCss: '' },
    { name: 'Current design', source: 'baseline' }
  )
  if (!current.ok) return { ok: false, status: 409, error: `The current design can’t be read: ${current.errors.join(' ')}` }
  const violations = capabilityViolations(bundle, current.bundle, await readDesignCapabilities(target.githubRepo))
  if (violations.length > 0) return { ok: false, status: 422, error: violations.join(' ') }

  let result: Awaited<ReturnType<typeof applyBundleToDraft>>
  try {
    result = await applyBundleToDraft({
      githubRepo: target.githubRepo,
      bundle,
      removeLegacy: args.removeLegacy,
      message: args.commitMessage,
      author: { name: target.adminName ?? DEFAULT_COMMIT_AUTHOR.name, email: target.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email },
      ...(expectedShas ? { base: before } : {}),
      ...(args.overridesVerbatim !== undefined ? { overridesVerbatim: args.overridesVerbatim } : {}),
    })
  } catch (err) {
    if (err instanceof StaleShaError) return { ok: false, status: 409, error: STALE_THEME_ERROR, stale: true }
    throw err
  }
  if (!result.ok) return { ok: false, status: result.status, error: result.error }

  if (args.skipIfUnchanged && result.changedPaths.length === 0) {
    return { ok: true, version: null, commitSha: null, changedPaths: [], appliedBlobs: mergeAppliedBlobs(before.shas, {}), css: result.css }
  }

  if (args.syncMbp) {
    await syncMbpTheme(db, {
      sessionId: target.sessionId,
      jobId: target.jobId,
      brand: result.changedPaths.includes(BRAND_PATH) ? result.brand : undefined,
      design: result.changedPaths.includes(DESIGN_PATH) ? result.design : undefined,
    })
  }

  // applied_blobs MUST be the full four-file map (drift compares to it).
  // With a base, the commit was guarded against every base blob, so base +
  // written IS the draft's theme now. Without one, written blobs win: right
  // after updateRef the (ETag-conditional) tree read can still return the
  // pre-commit tip, so the snapshot only fills the files this commit didn't touch.
  let appliedBlobs: ThemeBlobShas
  if (expectedShas) {
    appliedBlobs = mergeAppliedBlobs(before.shas, result.blobs)
  } else {
    try {
      appliedBlobs = mergeAppliedBlobs((await readDraftThemeSnapshot(target.githubRepo)).shas, result.blobs)
    } catch (err) {
      console.warn('[design:commit] post-apply snapshot failed, using before + written shas:', err)
      appliedBlobs = mergeAppliedBlobs(before.shas, result.blobs)
    }
  }

  // The draft commit has landed: any failure from here on must say so, never
  // a generic "failed to apply" that invites a second apply.
  try {
    const version = await insertVersion(db, {
      sessionId: target.sessionId,
      source: args.source,
      bundle: { ...bundle, css: result.css },
      summary: args.summary.slice(0, 500),
      appliedCommitSha: result.commitSha,
      appliedBlobs,
      conceptId: args.conceptId ?? null,
      createdBy: target.adminId,
      screenshots: args.screenshots ?? [],
    })
    return { ok: true, version, commitSha: result.commitSha, changedPaths: result.changedPaths, appliedBlobs, css: result.css }
  } catch (err) {
    if (err instanceof VersionConflictError) return { ok: false, status: 409, error: APPLIED_VERSION_NUMBER_UNRECORDED }
    console.error('[design:commit] the draft commit landed but its version could not be recorded:', err)
    return { ok: false, status: 409, error: APPLIED_VERSION_UNRECORDED }
  }
}
