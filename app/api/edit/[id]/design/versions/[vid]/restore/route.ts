import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { parseDesignBundle } from '@/lib/design/bundle'
import { isUuid } from '@/lib/design/input-validation'
import { parseScreenshots } from '@/lib/design/screenshots'
import { getVersion } from '@/lib/design/store'
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
}

type Params = { params: Promise<{ id: string; vid: string }> }

// POST — restore version k: re-apply its bundle to the DRAFT as a NEW forward
// version (source 'revert'), never a git revert (spec "Versioning semantics").
// Same commit path as concept apply (commitDesignVersion: capability tier,
// sanitizer, contrast, sha guards, MBP sync, full applied_blobs). Hand-written
// CSS outside the Studio's managed region is kept (removeLegacy: false) — a
// restore reproduces the version's levers + managed region, nothing else. No
// render gate: the version was on the draft before.
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
    const committed = await commitDesignVersion(db, {
      target: { sessionId: ctx.sessionId, jobId: ctx.jobId, githubRepo: ctx.githubRepo, adminId: ctx.adminId, adminEmail: ctx.adminEmail, adminName: ctx.adminName },
      bundle: { ...parsed.bundle, name: restoredName, meta: { source: 'revert' } },
      source: 'revert',
      removeLegacy: false,
      syncMbp: true,
      summary: `Restored v${row.version_no} “${name}”`,
      commitMessage: `Design Studio: restore v${row.version_no} "${name}" (${ctx.adminEmail ?? 'admin'})`,
      screenshots: parseScreenshots(row.screenshots),
    })
    if (!committed.ok) {
      return NextResponse.json(committed.stale ? { error: committed.error, stale: true } : { error: committed.error }, { status: committed.status })
    }
    if (!committed.version) return NextResponse.json({ error: 'The version could not be recorded — refresh the Studio.' }, { status: 409 })
    const response: RestoreVersionResponse = {
      ok: true,
      versionId: committed.version.id,
      versionNo: committed.version.version_no,
      restoredFrom: row.version_no,
      commitSha: committed.commitSha,
      changedPaths: committed.changedPaths,
    }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:version:restore', err, 'Failed to restore the version')
  }
}
