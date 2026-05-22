import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { DRAFT_BRANCH, ensureDraftBranch, listTree } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const entries = await listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/')
    return NextResponse.json({
      repo: ctx.githubRepo,
      branch: DRAFT_BRANCH,
      entries: entries.filter((e) => e.type === 'blob'),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
