import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runResearchPipeline } from '@/lib/content/research-pipeline'
import type { SessionSchema } from '@/types/session-schema'
import { asJson } from '@/lib/supabase/json-typed'

type SitemapPage = NonNullable<SessionSchema['proposed_sitemap']>[number]

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const supabase = createServerClient()

  const { data: job, error } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap')
    .eq('id', id)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  // Return confirmed sitemap if it exists, otherwise load proposed from session
  if (job.confirmed_sitemap) {
    return NextResponse.json({ pages: job.confirmed_sitemap, confirmed: true })
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', job.session_id)
    .single()

  const schemaData = (session?.schema_data ?? {}) as Record<string, unknown>
  const proposed = (schemaData.proposed_sitemap ?? []) as SitemapPage[]

  return NextResponse.json({ pages: proposed, confirmed: false })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireAdmin()
  if (authCheck instanceof NextResponse) return authCheck
  const { id } = await params
  const { pages }: { pages: SitemapPage[] } = await req.json()

  // Validate
  if (!pages || pages.length === 0) {
    return NextResponse.json({ error: 'At least one page is required' }, { status: 400 })
  }
  for (const page of pages) {
    if (!page.title?.trim() || !page.url?.trim()) {
      return NextResponse.json({ error: 'All pages must have a title and URL' }, { status: 400 })
    }
  }

  const supabase = createServerClient()

  // Persist the confirmed sitemap first — the seeds depend on it being current.
  const { error: sitemapErr } = await supabase
    .from('content_jobs')
    .update({
      confirmed_sitemap: asJson(pages),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (sitemapErr) {
    return NextResponse.json({ error: sitemapErr.message }, { status: 500 })
  }

  // Clear any existing rows from a previous confirmation.
  await Promise.all([
    supabase.from('research_results').delete().eq('content_job_id', id),
    supabase.from('page_outlines').delete().eq('content_job_id', id),
    supabase.from('generated_pages').delete().eq('content_job_id', id),
  ])

  // Seed research_results, page_outlines, generated_pages for each page.
  const seedRows = pages.map(p => ({
    content_job_id: id,
    page_url: p.url,
    page_title: p.title,
  }))

  const [r1, r2, r3] = await Promise.all([
    supabase.from('research_results').insert(seedRows),
    supabase.from('page_outlines').insert(seedRows),
    supabase.from('generated_pages').insert(seedRows),
  ])

  if (r1.error || r2.error || r3.error) {
    console.error('[sitemap] Seed errors:', r1.error, r2.error, r3.error)
    // Don't advance phase if seeds failed — admin can retry without ending up
    // at phase 3 with nothing for the pipeline to process.
    return NextResponse.json(
      { error: 'Failed to seed pipeline rows; check server logs' },
      { status: 500 }
    )
  }

  // Seeds in place — now advance the phase.
  const { error: phaseErr } = await supabase
    .from('content_jobs')
    .update({ phase: 3, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (phaseErr) {
    return NextResponse.json({ error: phaseErr.message }, { status: 500 })
  }

  console.warn(`[content-job] phase 2→3 session=${id} pages=${pages.length}`)

  // Get the session_id for the research pipeline
  const { data: jobData } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()

  // after() runs post-response with Vercel's guarantee it completes within
  // maxDuration. Plain fire-and-forget gets terminated by Vercel once the
  // response leaves the function.
  if (jobData) {
    const sessionId = jobData.session_id
    after(async () => {
      try {
        await runResearchPipeline(id, pages, sessionId)
      } catch (err) {
        console.error('[Research] Pipeline failed:', err)
      }
    })
  }

  return NextResponse.json({ success: true, pageCount: pages.length })
}
