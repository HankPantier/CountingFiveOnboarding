import { NextResponse, after } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { getStatus, DRAFT_BRANCH } from '@/lib/github/repo-files'
import { containsDeployCommit } from '@/lib/github/deploy-commit'
import { cacheVercelPreviewUrl } from '@/lib/theme-preview/site-url'

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
    .select('github_repo, preview_url')
    .eq('id', id)
    .single()

  if (!job?.github_repo) {
    return NextResponse.json({ repo: null })
  }

  try {
    const status = await getStatus(job.github_repo)
    const isDeployCommit = containsDeployCommit(status.aheadCommitMessages)
    // First deploy of a site: record its Vercel address as the preview URL
    // (Theme/Design Studio) once the deploy landed, so it never falls back to
    // the client's old site. Background, never blocks the poll; a miss is
    // negative-cached for 10 min, so the 8 s poll doesn't repeat it.
    if (isDeployCommit && !job.preview_url) {
      const githubRepo = job.github_repo
      after(async () => {
        await cacheVercelPreviewUrl({ jobId: id, githubRepo })
      })
    }
    return NextResponse.json({
      repo: job.github_repo,
      branch: DRAFT_BRANCH,
      reachable: true,
      lastCommitSha: status.lastCommitSha,
      lastCommitMessage: status.lastCommitMessage,
      lastCommitAt: status.lastCommitAt,
      isDeployCommit,
      draftAhead: status.draftAhead,
    })
  } catch {
    return NextResponse.json({ repo: job.github_repo, reachable: false })
  }
}
