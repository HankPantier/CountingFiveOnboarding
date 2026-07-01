import { NextResponse } from 'next/server'
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
    const message = err instanceof Error ? err.message : 'Failed to seed repo'
    console.error('[seed-repo] Seed failed:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
