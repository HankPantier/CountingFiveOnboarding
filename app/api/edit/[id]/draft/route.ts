import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import {
  ensureDraftBranch,
  resetDraftToMain,
  syncMainIntoDraft,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

type Body = { action?: 'sync' | 'reset' }

// POST { action } — keep the long-lived draft branch in step with main.
//  - 'sync':  merge live (main) into draft so a later publish doesn't conflict.
//  - 'reset': force draft back to main, discarding unpublished draft edits.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { action } = body
  if (action !== 'sync' && action !== 'reset') {
    return NextResponse.json({ error: "action must be 'sync' or 'reset'" }, { status: 400 })
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    if (action === 'reset') {
      await resetDraftToMain(ctx.githubRepo)
      return NextResponse.json({ action: 'reset', reset: true })
    }
    const result = await syncMainIntoDraft(ctx.githubRepo)
    return NextResponse.json({ action: 'sync', ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
