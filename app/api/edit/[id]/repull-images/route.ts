import { NextResponse } from 'next/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../_helpers'
import { repullJobImages } from '@/lib/content/repull-images'

export const runtime = 'nodejs'
// Whole-site Pexels re-fetch + git blob push shares this budget — large sites
// (dozens of pages) need headroom past the default.
export const maxDuration = 300

// Re-pull every stock/hero image for this session's content job and commit any
// missing ones to the draft branch. Session-keyed sibling of
// /api/content-jobs/[id]/images/repull, exposed in the content editor's ••• menu.
// resolveEditContext gates for admin/manager/editor (all may stage to draft) and
// resolves the content job + repo; pushes to draft only, so no canPublish gate.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let force = false
  let taskId: string | undefined
  try {
    const body = await req.json()
    force = body?.force === true
    if (typeof body?.taskId === 'string') taskId = body.taskId
  } catch {
    // no body — defaults
  }

  let result
  try {
    result = await repullJobImages(
      ctx.jobId,
      { name: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name, email: ctx.adminEmail ?? null, id: ctx.adminId },
      { force, taskId }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image re-pull failed'
    console.error('[repull] Unhandled error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!result.ok) {
    const { ok: _ok, status, ...body } = result
    return NextResponse.json(body, { status })
  }
  const { ok: _ok, ...body } = result
  return NextResponse.json({ success: true, ...body })
}
