import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runResearchPipeline } from '@/lib/content/research-pipeline'

export const runtime = 'nodejs'
export const maxDuration = 120

type SitemapPage = {
  url: string
  title: string
  status: string
  parent?: string
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  // Only target 'error' rows. Including 'running' here would race with any
  // pipeline that's still actually executing — both runs would write the same
  // rows and could clobber each other's progress / double-charge tokens. Rows
  // genuinely orphaned in 'running' (crashed pipeline) should be cleared via a
  // separate, explicit action; the lower-friction retry covers the common case.
  const { data: stale } = await supabase
    .from('research_results')
    .select('id, page_url')
    .eq('content_job_id', id)
    .eq('research_status', 'error')

  if (!stale?.length) {
    return NextResponse.json({ retried: 0, message: 'No failed pages to retry' })
  }

  await supabase
    .from('research_results')
    .update({
      research_status: 'pending',
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', stale.map(s => s.id))

  const sitemap = (job.confirmed_sitemap ?? []) as SitemapPage[]
  const retryUrls = new Set(stale.map(s => s.page_url))
  const pagesToRetry = sitemap.filter(p => retryUrls.has(p.url))

  // after() runs post-response with Vercel's guarantee it completes within
  // maxDuration. Plain fire-and-forget gets terminated by Vercel once the
  // response leaves the function.
  after(async () => {
    try {
      await runResearchPipeline(id, pagesToRetry, job.session_id)
    } catch (err) {
      console.error('[research-retry] Pipeline failed:', err)
    }
  })

  return NextResponse.json({ retried: stale.length })
}
