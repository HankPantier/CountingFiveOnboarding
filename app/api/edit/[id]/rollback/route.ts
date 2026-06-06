import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { revertLastPublish } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

// Undo the most recent publish: force main back to its pre-publish state.
// Draft keeps the published content so the admin can fix and re-publish.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

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
