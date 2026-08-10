import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { MAIN_BRANCH, listTree } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

// Blog post .md paths that are LIVE (present on main). The Resources panel uses
// this to hide ideas whose drafted post has already been published — a drafted
// idea's draft_path (content/posts/{slug}.md) appearing here means it's live.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    const tree = await listTree(ctx.githubRepo, MAIN_BRANCH, 'content/posts/')
    const paths = tree
      .filter((e) => e.type === 'blob' && e.path.endsWith('.md'))
      .map((e) => e.path)
    return NextResponse.json({ paths }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
