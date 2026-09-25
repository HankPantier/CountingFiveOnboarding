import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { StaleShaError } from '@/lib/github/repo-files'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { BRAND_PATH, DESIGN_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { parseDesignBundle } from '@/lib/design/bundle'
import { capabilityViolations } from '@/lib/design/capabilities'
import { readDesignCapabilities } from '@/lib/design/capabilities-read'
import { mergeAppliedBlobs } from '@/lib/design/drift'
import { isPlainObject, isUuid } from '@/lib/design/input-validation'
import { applyRenderGate, parseConceptReview, renderGateMessage } from '@/lib/design/review'
import { getConcept, getRun, markRunApplied } from '@/lib/design/run-store'
import { parseBaseSnapshot, parseScreenshots } from '@/lib/design/run-state'
import { insertVersion, VersionConflictError } from '@/lib/design/store'
import type { ThemeBlobShas } from '@/lib/design/studio-types'
import { syncMbpTheme } from '@/lib/design/sync-mbp-theme'
import { readDraftThemeSnapshot, themeTextsFromSnapshot } from '@/lib/design/theme-snapshot'
import { requireDesignAdmin } from '../../../_design'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ApplyConceptBody {
  removeLegacyOverrides?: unknown
}

interface ApplyConceptResponse {
  ok: true
  versionId: string
  versionNo: number
  commitSha: string | null
  changedPaths: string[]
  warnings: string[]
}

type Params = { params: Promise<{ id: string; cid: string }> }

const APPLIED_VERSION_NUMBER_UNRECORDED = 'The design was applied to the draft, but its version number could not be recorded — refresh the Studio.'
const APPLIED_VERSION_UNRECORDED = 'The design was applied to the draft, but its version could not be recorded — refresh the Studio.'

// POST — apply a ready concept to the DRAFT branch as one atomic commit, then
// mirror the palette/fonts into the MBP and record a `concept` version.
// Gates, in order: stored bundle re-parsed (zod) → the concept's LATEST
// render's metrics, baseline-diffed against the current site (P4's render
// hard gates: AA contrast / mobile overflow / hidden blocks — 422 on a new
// failure; unmeasured is allowed with a warning) → template capability tier
// (fonts locked below L2) → applyBundleToDraft, which re-sanitizes every CSS
// fragment, hard-gates checkThemeContrast, and guards every file with its
// expected blob sha (StaleShaError → 409).
// Publishing is unchanged (the editor's Publish ships ALL of draft).
export async function POST(req: Request, { params }: Params) {
  const { id, cid } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(cid)) return NextResponse.json({ error: 'Invalid concept id' }, { status: 400 })

  const raw = await readJsonBody<ApplyConceptBody>(req)
  if (raw instanceof NextResponse) return raw
  if (!isPlainObject(raw)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const flag = raw.removeLegacyOverrides
  if (flag !== undefined && typeof flag !== 'boolean') {
    return NextResponse.json({ error: 'removeLegacyOverrides must be true or false.' }, { status: 400 })
  }
  const removeLegacy = flag ?? true

  // Native-backed (lightningcss) — lazy, traced in next.config.ts.
  let engine: {
    applyBundleToDraft: (typeof import('@/lib/design/apply-bundle'))['applyBundleToDraft']
    bundleFromRepoFiles: (typeof import('@/lib/design/bundle-files'))['bundleFromRepoFiles']
  }
  try {
    const [apply, files] = await Promise.all([import('@/lib/design/apply-bundle'), import('@/lib/design/bundle-files')])
    engine = { applyBundleToDraft: apply.applyBundleToDraft, bundleFromRepoFiles: files.bundleFromRepoFiles }
  } catch (err) {
    console.error('[design:concept:apply] failed to load the design engine', err)
    return NextResponse.json({ error: 'The design engine is unavailable right now.' }, { status: 503 })
  }

  try {
    const db = createServerClient()
    const concept = await getConcept(db, ctx.sessionId, cid)
    if (!concept) return NextResponse.json({ error: 'Concept not found.' }, { status: 404 })
    if (concept.status !== 'ready' || concept.bundle === null) {
      return NextResponse.json({ error: 'This concept is not ready to apply yet.' }, { status: 409 })
    }
    const parsed = parseDesignBundle(concept.bundle)
    if (!parsed.ok) {
      return NextResponse.json({ error: `This concept can no longer be applied: ${parsed.errors.join(' ')}` }, { status: 422 })
    }
    const bundle = parsed.bundle

    // Render hard gates (spec "hard gates before apply"; P4): the concept's
    // LATEST render must pass AA contrast, no mobile overflow and no hidden
    // blocks, relative to the current site (the run's baseline). A concept
    // that couldn't be rendered is allowed, with a warning.
    const run = await getRun(db, ctx.sessionId, concept.run_id)
    const baseline = run ? (parseBaseSnapshot(run.base_snapshot).metrics ?? null) : null
    const gate = applyRenderGate(parseConceptReview(concept.critique), baseline)
    if (!gate.ok) return NextResponse.json({ error: renderGateMessage(gate.failures), failures: gate.failures }, { status: 422 })

    const before = await readDraftThemeSnapshot(ctx.githubRepo)
    const draft = themeTextsFromSnapshot(before)
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 409 })
    // Only the fonts matter for the capability check, so the overrides file
    // (and any malformed region in it) is irrelevant here.
    const current = engine.bundleFromRepoFiles(
      { brandText: draft.files.brandText, designText: draft.files.designText, overridesCss: '' },
      { name: 'Current design', source: 'baseline' }
    )
    if (!current.ok) {
      return NextResponse.json({ error: `The current design can’t be read: ${current.errors.join(' ')}` }, { status: 409 })
    }
    const violations = capabilityViolations(bundle, current.bundle, await readDesignCapabilities(ctx.githubRepo))
    if (violations.length > 0) return NextResponse.json({ error: violations.join(' ') }, { status: 422 })

    const result = await engine.applyBundleToDraft({
      githubRepo: ctx.githubRepo,
      bundle,
      removeLegacy,
      message: `Design Studio: apply concept "${bundle.name}" (${ctx.adminEmail ?? 'admin'})`,
      author: { name: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name, email: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email },
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    await syncMbpTheme(db, {
      sessionId: ctx.sessionId,
      jobId: ctx.jobId,
      brand: result.changedPaths.includes(BRAND_PATH) ? result.brand : undefined,
      design: result.changedPaths.includes(DESIGN_PATH) ? result.design : undefined,
    })

    // applied_blobs MUST be the full four-file map (drift compares to it).
    // Written blobs win: right after updateRef the (ETag-conditional) tree read
    // can still return the pre-commit tip, so the snapshot only fills the
    // files this commit didn't touch.
    let appliedBlobs: ThemeBlobShas
    try {
      appliedBlobs = mergeAppliedBlobs((await readDraftThemeSnapshot(ctx.githubRepo)).shas, result.blobs)
    } catch (err) {
      console.warn('[design:concept:apply] post-apply snapshot failed, using before + written shas:', err)
      appliedBlobs = mergeAppliedBlobs(before.shas, result.blobs)
    }

    // The draft commit has landed: any failure from here on must say so, never
    // a generic "failed to apply" that invites a second apply.
    let version: Awaited<ReturnType<typeof insertVersion>>
    try {
      version = await insertVersion(db, {
        sessionId: ctx.sessionId,
        source: 'concept',
        bundle: { ...bundle, css: result.css },
        summary: `Concept “${bundle.name}”${removeLegacy ? ' — legacy overrides removed' : ''}`.slice(0, 500),
        appliedCommitSha: result.commitSha,
        appliedBlobs,
        conceptId: concept.id,
        createdBy: ctx.adminId,
        screenshots: parseScreenshots(concept.screenshots),
      })
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return NextResponse.json({ error: APPLIED_VERSION_NUMBER_UNRECORDED }, { status: 409 })
      }
      // Logged server-side (raw DB text never reaches the client); same 409
      // shape as the conflict so the Apply dialog shows the message as-is.
      return internalError('design:concept:apply', err, APPLIED_VERSION_UNRECORDED, 409)
    }
    try {
      await markRunApplied(db, concept.run_id)
    } catch (err) {
      console.warn('[design:concept:apply] could not mark the run applied:', err)
    }

    const response: ApplyConceptResponse = {
      ok: true,
      versionId: version.id,
      versionNo: version.version_no,
      commitSha: result.commitSha,
      changedPaths: result.changedPaths,
      warnings: gate.warnings,
    }
    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json({ error: 'The theme changed while applying — refresh the Studio and try again.', stale: true }, { status: 409 })
    }
    return internalError('design:concept:apply', err, 'Failed to apply the concept')
  }
}
