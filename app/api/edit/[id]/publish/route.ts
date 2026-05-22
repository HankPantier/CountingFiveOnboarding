import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import {
  ensureDraftBranch,
  mergeDraftToMain,
  resetDraftToMain,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await mergeDraftToMain(ctx.githubRepo)
    if (result.merged) {
      // Reset draft to point at the new main so future edits start clean.
      await resetDraftToMain(ctx.githubRepo)
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
