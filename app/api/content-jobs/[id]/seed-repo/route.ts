import { NextResponse } from 'next/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { requireContentJobAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { seedRepoFromTemplate } from '@/lib/github/template-seed'
import { githubErrorHint } from '@/lib/github/error-hint'
import { internalError } from '@/lib/api/errors'

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
      authorName: DEFAULT_COMMIT_AUTHOR.name,
      authorEmail: auth.user.email ?? DEFAULT_COMMIT_AUTHOR.email,
    })
    return NextResponse.json(result)
  } catch (err) {
    // Only the curated rate-limit / permission hints reach the browser; the raw
    // GitHub text is logged by internalError.
    return internalError('seed-repo', err, githubErrorHint(err, job.github_repo) ?? 'Repo seeding failed')
  }
}
