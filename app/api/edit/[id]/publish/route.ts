import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { canPublish } from '@/lib/auth/access'
import { getLibrarySelectionStatus } from '@/lib/content/library-inclusion'
import { getDraftImageCoverage } from '@/lib/content/repull-images'
import {
  ensureDraftBranch,
  mergeDraftToMain,
  resetDraftToMain,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'
// Publishing makes 3–4 sequential GitHub round-trips (ensureDraftBranch →
// mergeDraftToMain → resetDraftToMain). Without this the Vercel default (~10s)
// can 504 mid-merge, leaving the operator unsure whether main advanced.
export const maxDuration = 60

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // Pushing to live is denied to editors (content users who can stage but not
  // publish). resolveEditContext already resolved the caller — reuse ctx.user
  // rather than a second getCurrentUser() round-trip.
  if (!canPublish(ctx.user)) {
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

  // Don't merge a draft that still references unresolved images — the live site
  // would render "Image not found". The Deliverables one-click flow checks this
  // client-side; this closes the gap for a direct editor publish.
  const coverage = await getDraftImageCoverage(ctx.jobId)
  if (!coverage.ok) {
    return NextResponse.json(
      {
        error: `${coverage.missing.length} image${coverage.missing.length === 1 ? '' : 's'} on this site ${coverage.missing.length === 1 ? "hasn't" : "haven't"} resolved yet. Re-pull images from the editor's ••• menu, then publish.`,
        imagesMissing: true,
        missing: coverage.missing,
      },
      { status: 409 }
    )
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await mergeDraftToMain(ctx.githubRepo)
    if (result.merged) {
      // The publish (draft→main) already succeeded. Resetting draft back to the
      // new main is housekeeping — a failure here is non-fatal (the editor
      // self-heals a behind draft on next load), so don't 500 a live publish.
      try {
        await resetDraftToMain(ctx.githubRepo)
      } catch (resetErr) {
        console.error('[publish] draft reset after merge failed (non-fatal):', resetErr)
      }
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
