import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { parseDesignBundle } from '@/lib/design/bundle'
import { isPlainObject, isUuid } from '@/lib/design/input-validation'
import { applyRenderGate, parseConceptReview, renderGateMessage } from '@/lib/design/review'
import { getConcept, getRun, markRunApplied } from '@/lib/design/run-store'
import { parseBaseSnapshot, parseScreenshots } from '@/lib/design/run-state'
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

// POST — apply a ready concept to the DRAFT branch as one atomic commit, then
// mirror the palette/fonts into the MBP and record a `concept` version.
// Gates here: stored bundle re-parsed (zod) → the concept's LATEST render's
// metrics, baseline-diffed against the current site (P4's render hard gates:
// AA contrast / mobile overflow / hidden blocks — 422 on a new failure;
// unmeasured is allowed with a warning). Everything after that — the template
// capability tier (fonts locked below L2), applyBundleToDraft (re-sanitize,
// checkThemeContrast, expected-sha guards → 409 stale), the MBP sync, the
// full applied-blob map and the version record — lives in the shared
// commitDesignVersion() (lib/design/commit-version.ts).
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
  let commitDesignVersion: (typeof import('@/lib/design/commit-version'))['commitDesignVersion']
  let APPLIED_VERSION_UNRECORDED: string
  try {
    ;({ commitDesignVersion, APPLIED_VERSION_UNRECORDED } = await import('@/lib/design/commit-version'))
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

    const committed = await commitDesignVersion(db, {
      target: { sessionId: ctx.sessionId, jobId: ctx.jobId, githubRepo: ctx.githubRepo, adminId: ctx.adminId, adminEmail: ctx.adminEmail, adminName: ctx.adminName },
      bundle,
      source: 'concept',
      removeLegacy,
      syncMbp: true,
      summary: `Concept “${bundle.name}”${removeLegacy ? ' — legacy overrides removed' : ''}`,
      commitMessage: `Design Studio: apply concept "${bundle.name}" (${ctx.adminEmail ?? 'admin'})`,
      conceptId: concept.id,
      screenshots: parseScreenshots(concept.screenshots),
    })
    if (!committed.ok) {
      return NextResponse.json(committed.stale ? { error: committed.error, stale: true } : { error: committed.error }, { status: committed.status })
    }
    const version = committed.version
    // Unreachable without skipIfUnchanged, but keeps the type honest.
    if (!version) return NextResponse.json({ error: APPLIED_VERSION_UNRECORDED }, { status: 409 })
    try {
      await markRunApplied(db, concept.run_id)
    } catch (err) {
      console.warn('[design:concept:apply] could not mark the run applied:', err)
    }

    const response: ApplyConceptResponse = {
      ok: true,
      versionId: version.id,
      versionNo: version.version_no,
      commitSha: committed.commitSha,
      changedPaths: committed.changedPaths,
      warnings: gate.warnings,
    }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:concept:apply', err, 'Failed to apply the concept')
  }
}
