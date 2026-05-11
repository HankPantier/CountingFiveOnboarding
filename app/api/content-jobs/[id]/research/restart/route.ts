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

  // Reset pending, error, and stale-running rows. A row is "stale-running" if
  // it has been in 'running' for longer than STALE_RUNNING_MS — long enough
  // that no healthy pipeline could still be working on it (per-page work is
  // ~10-30s in practice). Active in-flight rows are protected by their fresh
  // updated_at, so we cannot clobber a healthy pipeline.
  const STALE_RUNNING_MS = 5 * 60 * 1000
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString()

  const [{ data: pendingOrError }, { data: staleRunning }] = await Promise.all([
    supabase
      .from('research_results')
      .select('id, page_url')
      .eq('content_job_id', id)
      .in('research_status', ['pending', 'error']),
    supabase
      .from('research_results')
      .select('id, page_url')
      .eq('content_job_id', id)
      .eq('research_status', 'running')
      .lt('updated_at', staleCutoff),
  ])

  const stuck = [...(pendingOrError ?? []), ...(staleRunning ?? [])]

  if (!stuck.length) {
    return NextResponse.json({ restarted: 0, message: 'Nothing to restart' })
  }

  await supabase
    .from('research_results')
    .update({
      research_status: 'pending',
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', stuck.map(s => s.id))

  const sitemap = (job.confirmed_sitemap ?? []) as SitemapPage[]
  const restartUrls = new Set(stuck.map(s => s.page_url))
  const pagesToRun = sitemap.filter(p => restartUrls.has(p.url))

  runResearchPipeline(id, pagesToRun, job.session_id).catch(err =>
    console.error('[research-restart] Pipeline failed:', err)
  )

  return NextResponse.json({ restarted: stuck.length })
}
