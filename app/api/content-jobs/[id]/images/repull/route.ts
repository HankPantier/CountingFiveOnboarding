import { NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { repullJobImages } from '@/lib/content/repull-images'

export const runtime = 'nodejs'
// Resolving a whole site's stock photos (SEQUENTIAL Pexels search + bounded
// parallel download) plus a git blob push shares this budget. The one-click
// publish flow now routes a large fresh site's entire first-time resolution
// through here, so give it 600 like the audit runners. Mirror in vercel.json.
export const maxDuration = 600

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // manager-capable (or admin). Pushes to draft only, so no canPublish gate.
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth

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
      id,
      { name: auth.user.name ?? 'CountingFive Admin', email: auth.user.email ?? null, id: auth.user.id },
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
