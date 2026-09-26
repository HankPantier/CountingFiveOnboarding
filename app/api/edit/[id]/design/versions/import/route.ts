import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { computeDrift, mergeAppliedBlobs, toBlobMap } from '@/lib/design/drift'
import { CAPTURED_NAME, insertVersion, latestVersion, VersionConflictError } from '@/lib/design/store'
import { readDraftThemeSnapshot, themeTextsFromSnapshot } from '@/lib/design/theme-snapshot'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

interface CaptureVersionResponse {
  ok: true
  versionId: string
  versionNo: number
}

const fileName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

// POST — "Capture as version" (the drift banner's action): record the draft's
// CURRENT theme as a new `import` version, so changes made outside the Studio
// (Controls, hand edits) become a version the Studio can restore. No commit —
// the draft already holds it. applied_blobs = the full current four-file map.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  let bundleFromRepoFiles: (typeof import('@/lib/design/bundle-files'))['bundleFromRepoFiles']
  try {
    ;({ bundleFromRepoFiles } = await import('@/lib/design/bundle-files')) // lightningcss — lazy
  } catch (err) {
    console.error('[design:version:import] failed to load the design engine', err)
    return NextResponse.json({ error: 'The design engine is unavailable right now.' }, { status: 503 })
  }

  try {
    const db = createServerClient()
    const [snapshot, latest] = await Promise.all([readDraftThemeSnapshot(ctx.githubRepo), latestVersion(db, ctx.sessionId)])
    const draft = themeTextsFromSnapshot(snapshot)
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 409 })
    const drift = computeDrift(snapshot.shas, latest ? { versionNo: latest.version_no, appliedBlobs: toBlobMap(latest.applied_blobs) } : null)
    if (drift.status === 'in-sync') {
      return NextResponse.json({ error: `Nothing to capture — the draft already matches v${drift.sinceVersion}.` }, { status: 409 })
    }
    const captured = bundleFromRepoFiles(
      { brandText: draft.files.brandText, designText: draft.files.designText, overridesCss: draft.files.overridesCss },
      { name: CAPTURED_NAME, source: 'import' }
    )
    if (!captured.ok) return NextResponse.json({ error: `The draft can’t be captured: ${captured.errors.join(' ')}`.slice(0, 500) }, { status: 409 })

    const changed = drift.changedPaths.map(fileName).join(', ')
    const version = await insertVersion(db, {
      sessionId: ctx.sessionId,
      source: 'import',
      bundle: captured.bundle,
      summary: changed ? `Captured from the draft — changed outside the Studio: ${changed}` : 'Captured from the draft',
      appliedCommitSha: null,
      appliedBlobs: mergeAppliedBlobs(snapshot.shas, {}),
      createdBy: ctx.adminId,
    })
    const response: CaptureVersionResponse = { ok: true, versionId: version.id, versionNo: version.version_no }
    return NextResponse.json(response, { status: 201 })
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return NextResponse.json({ error: 'Another version was recorded at the same time — refresh the Studio.' }, { status: 409 })
    }
    return internalError('design:version:import', err, 'Failed to capture the draft')
  }
}
