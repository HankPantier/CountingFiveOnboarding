import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { ensureDraftBranch, getStatus } from '@/lib/github/repo-files'

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
    const status = await getStatus(ctx.githubRepo)
    return NextResponse.json({
      ...status,
      repo: ctx.githubRepo,
      repoUrl: `https://github.com/${ctx.githubRepo.includes('/') ? ctx.githubRepo : `${process.env.GITHUB_ORG}/${ctx.githubRepo}`}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
