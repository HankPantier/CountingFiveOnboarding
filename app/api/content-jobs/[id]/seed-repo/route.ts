import { NextResponse } from 'next/server'
import { RequestError } from '@octokit/request-error'
import { requireContentJobAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { seedRepoFromTemplate } from '@/lib/github/template-seed'

export const runtime = 'nodejs'
// Copying ~180 template blobs is a one-time burst of GitHub calls; give it room
// well beyond the assemble route so a first-time seed never gets cut off.
export const maxDuration = 300

export async function POST(
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
    return NextResponse.json({ error: 'No GitHub repo is linked to this content job.' }, { status: 400 })
  }

  try {
    const result = await seedRepoFromTemplate(job.github_repo, {
      authorName: 'CountingFive Admin',
      authorEmail: auth.user.email ?? 'admin@countingfive.com',
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[seed-repo] Seed failed:', err)
    let message = err instanceof Error ? err.message : 'Failed to seed repo'
    // A 403 "Resource not accessible by integration" on a write endpoint means
    // the GitHub App lacks Contents: Read & Write on the target repo. Make that
    // actionable rather than leaving the raw octokit string.
    if (err instanceof RequestError && err.status === 403) {
      message = `${message} — the GitHub App needs "Contents: Read & Write" on ${job.github_repo} (and the repo must be in its installation scope).`
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
