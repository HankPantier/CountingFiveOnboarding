import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
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
  const auth = await requireAdmin()
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

  // Find rows that need retrying. 'running' is included because a crashed
  // pipeline can leave rows orphaned in that state.
  const { data: stale } = await supabase
    .from('research_results')
    .select('id, page_url')
    .eq('content_job_id', id)
    .in('research_status', ['error', 'running'])

  if (!stale?.length) {
    return NextResponse.json({ retried: 0, message: 'No failed or stuck pages to retry' })
  }

  await supabase
    .from('research_results')
    .update({ research_status: 'pending', error_message: null })
    .in('id', stale.map(s => s.id))

  const sitemap = (job.confirmed_sitemap ?? []) as SitemapPage[]
  const retryUrls = new Set(stale.map(s => s.page_url))
  const pagesToRetry = sitemap.filter(p => retryUrls.has(p.url))

  // Fire-and-forget — pipeline updates rows as it progresses and advances phase
  // when all rows reach terminal status.
  runResearchPipeline(id, pagesToRetry, job.session_id).catch(err =>
    console.error('[research-retry] Pipeline failed:', err)
  )

  return NextResponse.json({ retried: stale.length })
}
