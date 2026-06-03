import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { DRAFT_BRANCH, ensureDraftBranch, listAssets } from '@/lib/github/repo-files'

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
    const entries = await listAssets(ctx.githubRepo, DRAFT_BRANCH)
    return NextResponse.json({
      repo: ctx.githubRepo,
      branch: DRAFT_BRANCH,
      assets: entries.map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? null })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
