import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { runResearchPipeline } from '@/lib/content/research-pipeline'

export const runtime = 'nodejs'
// Must match RESEARCH_ROUTE_MAX_DURATION_MS.
export const maxDuration = 300

type SitemapPage = { url: string; title: string; status: string; parent?: string }

// Internal continuation for the research pipeline: runResearchPipeline
// self-chains here when its time budget runs out, and the sweep cron calls it
// for a phase-3 job whose research stalled. CRON_SECRET only (fails closed when
// unset). Re-runs every page still pending/error; complete pages are skipped
// by the pipeline and in-flight ones are protected by its per-row claim.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap, phase')
    .eq('id', id)
    .single()
  if (!job) return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  if (job.phase !== 3) return NextResponse.json({ started: false, reason: 'Job is not in research' })

  const { data: open } = await supabase
    .from('research_results')
    .select('page_url')
    .eq('content_job_id', id)
    .in('research_status', ['pending', 'error'])
  const openUrls = new Set((open ?? []).map((r) => r.page_url))
  const pages = ((job.confirmed_sitemap ?? []) as SitemapPage[]).filter((p) => openUrls.has(p.url))
  if (!pages.length) return NextResponse.json({ started: false, reason: 'Nothing left to research' })

  const sessionId = job.session_id
  after(async () => {
    try {
      await runResearchPipeline(id, pages, sessionId)
    } catch (err) {
      console.error('[research-continue] Pipeline failed:', err)
    }
  })
  return NextResponse.json({ started: true, pages: pages.length })
}
