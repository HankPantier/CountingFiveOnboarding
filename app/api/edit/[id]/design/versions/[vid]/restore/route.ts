import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { parseDesignBundle } from '@/lib/design/bundle'
import { isUuid } from '@/lib/design/input-validation'
import { parseScreenshots } from '@/lib/design/screenshots'
import { getVersion } from '@/lib/design/store'
import { toBlobMap } from '@/lib/design/drift'
import { readThemeSnapshotAt } from '@/lib/design/theme-snapshot'
import { OVERRIDES_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { deriveRestoreVersionName } from '@/lib/design/version-name'
import { requireDesignAdmin } from '../../../_design'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RestoreVersionResponse {
  ok: true
  versionId: string
  versionNo: number
  restoredFrom: number
  commitSha: string | null
  changedPaths: string[]
  warnings: string[]
}

// Baseline (v0) and captured versions describe the WHOLE draft theme, hand
// CSS outside the Studio region included - but a bundle only carries the
// region. Their applied_blobs pin the exact design-overrides.css blob, and
// blobs are immutable, so a restore writes that file back verbatim.
const VERBATIM_SOURCES = new Set(['baseline', 'import'])

const OVERRIDES_UNRECOVERABLE_WARNING = (versionNo: number): string =>
  `v${versionNo}’s original design-overrides.css couldn’t be read back, so the current hand-written CSS was kept — the site may not look exactly like v${versionNo}. Check it in the preview before publishing.`
const OVERRIDES_DIFFER_WARNING = (versionNo: number): string =>
  `design-overrides.css now differs from v${versionNo}’s: hand-written CSS outside the Studio region isn’t part of this version, so the current hand CSS was kept.`

type Params = { params: Promise<{ id: string; vid: string }> }

// POST — restore version k: re-apply its bundle to the DRAFT as a NEW forward
// version (source 'revert'), never a git revert (spec "Versioning semantics").
// Same commit path as concept apply (commitDesignVersion: capability tier,
// sanitizer, contrast, sha guards, MBP sync, full applied_blobs). Hand-written
// CSS outside the Studio's managed region is kept (removeLegacy: false) — a
// restore reproduces the version's levers + managed region, nothing else. No
// render gate: the version was on the draft before. Baseline / captured
// versions restore their recorded design-overrides.css verbatim (see
// VERBATIM_SOURCES); otherwise a differing overrides file is reported as a
// warning so the version list never implies a faithful revert it didn't do.
export async function POST(_req: Request, { params }: Params) {
  const { id, vid } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(vid)) return NextResponse.json({ error: 'Invalid version id' }, { status: 400 })

  let commitDesignVersion: (typeof import('@/lib/design/commit-version'))['commitDesignVersion']
  try {
    ;({ commitDesignVersion } = await import('@/lib/design/commit-version')) // lightningcss — lazy
  } catch (err) {
    console.error('[design:version:restore] failed to load the design engine', err)
    return NextResponse.json({ error: 'The design engine is unavailable right now.' }, { status: 503 })
  }

  try {
    const db = createServerClient()
    const row = await getVersion(db, ctx.sessionId, vid)
    if (!row) return NextResponse.json({ error: 'Version not found.' }, { status: 404 })
    const parsed = parseDesignBundle(row.bundle)
    if (!parsed.ok) {
      return NextResponse.json({ error: `v${row.version_no} can no longer be restored: ${parsed.errors.join(' ')}`.slice(0, 500) }, { status: 422 })
    }
    const name = parsed.bundle.name
    // The restored version's own name is "Restored v{k}[ — {original name}]",
    // not the original bundle's name carried over verbatim (which would show
    // as e.g. "Baseline" on every restore of v0).
    const restoredName = deriveRestoreVersionName(row.version_no, name)

    const warnings: string[] = []
    const recordedOverridesSha = toBlobMap(row.applied_blobs)[OVERRIDES_PATH] ?? null
    let overridesVerbatim: string | undefined
    if (VERBATIM_SOURCES.has(row.source)) {
      if (recordedOverridesSha === null) {
        overridesVerbatim = '' // the file did not exist when this version was recorded
      } else {
        try {
          const text = (await readThemeSnapshotAt(ctx.githubRepo, { [OVERRIDES_PATH]: recordedOverridesSha })).texts[OVERRIDES_PATH]
          if (text !== undefined) overridesVerbatim = text
          else warnings.push(OVERRIDES_UNRECOVERABLE_WARNING(row.version_no))
        } catch (err) {
          console.warn('[design:version:restore] recorded overrides blob unreadable:', err)
          warnings.push(OVERRIDES_UNRECOVERABLE_WARNING(row.version_no))
        }
      }
    }

    const committed = await commitDesignVersion(db, {
      target: { sessionId: ctx.sessionId, jobId: ctx.jobId, githubRepo: ctx.githubRepo, adminId: ctx.adminId, adminEmail: ctx.adminEmail, adminName: ctx.adminName },
      bundle: { ...parsed.bundle, name: restoredName, meta: { source: 'revert' } },
      source: 'revert',
      removeLegacy: false,
      syncMbp: true,
      summary: `Restored v${row.version_no} “${name}”`,
      commitMessage: `Design Studio: restore v${row.version_no} "${name}" (${ctx.adminEmail ?? 'admin'})`,
      screenshots: parseScreenshots(row.screenshots),
      ...(overridesVerbatim !== undefined ? { overridesVerbatim } : {}),
    })
    if (!committed.ok) {
      return NextResponse.json(committed.stale ? { error: committed.error, stale: true } : { error: committed.error }, { status: committed.status })
    }
    if (!committed.version) return NextResponse.json({ error: 'The version could not be recorded — refresh the Studio.' }, { status: 409 })
    const resultOverridesSha = committed.appliedBlobs[OVERRIDES_PATH] ?? null
    if (overridesVerbatim === undefined && warnings.length === 0 && recordedOverridesSha !== resultOverridesSha) warnings.push(OVERRIDES_DIFFER_WARNING(row.version_no))
    const response: RestoreVersionResponse = {
      ok: true,
      versionId: committed.version.id,
      versionNo: committed.version.version_no,
      restoredFrom: row.version_no,
      commitSha: committed.commitSha,
      changedPaths: committed.changedPaths,
      warnings,
    }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:version:restore', err, 'Failed to restore the version')
  }
}
