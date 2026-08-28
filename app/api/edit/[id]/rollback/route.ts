import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { canPublish } from '@/lib/auth/access'
import { revertLastPublish } from '@/lib/github/repo-files'

export const runtime = 'nodejs'
// Rollback makes sequential GitHub round-trips; give it headroom over the ~10s
// Vercel default so a slow revert doesn't 504 with main in an ambiguous state.
export const maxDuration = 60

// Undo the most recent publish: force main back to its pre-publish state.
// Draft keeps the published content so the admin can fix and re-publish.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // Rollback mutates the live site — denied to editors (same gate as publish).
  // Reuse the caller resolveEditContext already resolved.
  if (!canPublish(ctx.user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await revertLastPublish(ctx.githubRepo)
    if (!result.reverted) {
      return NextResponse.json({ error: result.reason }, { status: 409 })
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
