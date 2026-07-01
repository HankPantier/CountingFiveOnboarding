import { NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { getStatus, DRAFT_BRANCH } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

// Lightweight read-only status for the decoupled deploy. The package route
// pushes in the background, so the UI polls this to confirm the deploy commit
// landed on the draft branch (the push commit message starts with
// "Deploy packaged content"). Never throws — a GitHub hiccup returns
// { repo, reachable: false } so the UI can keep polling or show a soft error.
const PUSH_COMMIT_PREFIX = 'Deploy packaged content'

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
      isDeployCommit: (status.lastCommitMessage ?? '').startsWith(PUSH_COMMIT_PREFIX),
      draftAhead: status.draftAhead,
    })
  } catch {
    return NextResponse.json({ repo: job.github_repo, reachable: false })
  }
}
