import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { canPublish, getCurrentUser } from '@/lib/auth/access'
import { getLibrarySelectionStatus } from '@/lib/content/library-inclusion'
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

  // Pushing to live is denied to editors (content users who can stage but not
  // publish). resolveEditContext already admitted them for draft editing.
  const user = await getCurrentUser()
  if (!user || !canPublish(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Don't ship a new site before its included library articles have been drafted
  // into the repo draft — publishing (draft→main) while selections are still
  // pending/drafting merges WITHOUT them, so they'd only appear after a second
  // publish. The Deliverables one-click flow runs them first; this closes the gap
  // for a direct editor publish. Terminal (complete/error/none) is allowed — an
  // errored article is a surfaced failure the operator already saw, not a reason
  // to block the whole site indefinitely.
  const libraryStatus = await getLibrarySelectionStatus(ctx.jobId)
  if (!libraryStatus.terminal) {
    const remaining = libraryStatus.pending + libraryStatus.drafting
    return NextResponse.json(
      {
        error: `${remaining} included library article${remaining === 1 ? '' : 's'} ${remaining === 1 ? "hasn't" : "haven't"} finished generating yet. Run them from the Deliverables step, then publish.`,
        libraryPending: true,
        status: libraryStatus,
      },
      { status: 409 }
    )
  }

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
