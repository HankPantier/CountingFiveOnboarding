import { NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { getStatus, DRAFT_BRANCH } from '@/lib/github/repo-files'
import { containsDeployCommit } from '@/lib/github/deploy-commit'

export const runtime = 'nodejs'

// Lightweight read-only status for the decoupled deploy. The package route
// pushes in the background, so the UI polls this to confirm the deploy commit
// landed on the draft branch. isDeployCommit checks the whole ahead-of-main
// commit set — not just HEAD — because the pipeline stacks follow-up commits
// (site-settings sync, editor moves) on top of the deploy within ~1s, so the
// deploy commit is rarely at HEAD after a successful publish. Never throws — a
// GitHub hiccup returns { repo, reachable: false } so the UI can keep polling.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo')
    .eq('id', id)
    .single()

  if (!job?.github_repo) {
    return NextResponse.json({ repo: null })
  }

  try {
    const status = await getStatus(job.github_repo)
    return NextResponse.json({
      repo: job.github_repo,
      branch: DRAFT_BRANCH,
      reachable: true,
      lastCommitSha: status.lastCommitSha,
      lastCommitMessage: status.lastCommitMessage,
      lastCommitAt: status.lastCommitAt,
      isDeployCommit: containsDeployCommit(status.aheadCommitMessages),
      draftAhead: status.draftAhead,
    })
  } catch {
    return NextResponse.json({ repo: job.github_repo, reachable: false })
  }
}
