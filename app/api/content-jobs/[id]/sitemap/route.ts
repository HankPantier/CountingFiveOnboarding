import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { reviewContentForMbpImpact } from '@/lib/mbp/impact-review'
import { runResearchPipeline } from '@/lib/content/research-pipeline'
import { assessContentReadiness } from '@/lib/content/content-readiness'
import { normUrl } from '@/lib/content/sitemap-proposer'
import { toSitePath } from '@/lib/content/url-path'
import type { SessionSchema } from '@/types/session-schema'
import { asJson } from '@/lib/supabase/json-typed'

type SitemapPage = NonNullable<SessionSchema['proposed_sitemap']>[number]

export const runtime = 'nodejs'
// POST runs the research pipeline in after(); it budgets against
// RESEARCH_ROUTE_MAX_DURATION_MS and self-chains past it. Must match.
export const maxDuration = 300

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
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

  // Advisory content-readiness so the UI can warn (before confirm) that the
  // content-critical MBP fields are thin and the copy will come out generic.
  const readiness = assessContentReadiness((session?.schema_data ?? {}) as SessionSchema)

  return NextResponse.json({ pages: proposed, confirmed: false, readiness })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const authCheck = await requireContentJobAccess(_jobId)
  if (authCheck instanceof NextResponse) return authCheck
  const { id } = await params
  const body = await readJsonBody<{ pages?: SitemapPage[] }>(req)
  if (body instanceof NextResponse) return body
  const { pages: rawPages } = body

  // Validate
  if (!rawPages || rawPages.length === 0) {
    return NextResponse.json({ error: 'At least one page is required' }, { status: 400 })
  }
  for (const page of rawPages) {
    if (!page.title?.trim() || !page.url?.trim()) {
      return NextResponse.json({ error: 'All pages must have a title and URL' }, { status: 400 })
    }
  }

  // Normalize every URL to a clean root-relative path FIRST, then dedup on the
  // normalized key. An absolute URL (/https://host/x) and its path (/x) hash to
  // different normUrl keys, so normalizing before dedup also collapses those.
  // This is the last chokepoint all confirmed-sitemap pages pass through, so it
  // guards the page-content filenames regardless of how a bad URL was entered.
  const normalizePage = (p: SitemapPage): SitemapPage => ({
    ...p,
    url: toSitePath(p.url) ?? p.url,
    ...(p.parent ? { parent: toSitePath(p.parent) ?? p.parent } : {}),
  })
  // Dedup by canonical URL before seeding. page_outlines has no unique
  // constraint on (content_job_id, page_url), so a duplicate URL (easy to
  // introduce when hand-editing the sitemap) would create duplicate outline
  // rows and make generateOutlineForPage's .single() research lookup throw.
  const seen = new Set<string>()
  const pages = rawPages.map(normalizePage).filter((p) => {
    const key = normUrl(p.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const supabase = createServerClient()

  // Confirm is only valid from the sitemap step (phase ≤ 2). A re-confirm while
  // the job is already in research/outlines/generation would wipe live pipeline
  // rows under a running worker — use "unapprove sitemap" to go back first.
  // The conditional update below doubles as the concurrency guard: two
  // simultaneous confirms both pass a read-check, but only one flips the job.
  const { data: jobRow } = await supabase
    .from('content_jobs')
    .select('phase, updated_at')
    .eq('id', id)
    .single()
  if (!jobRow) return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  if (jobRow.phase > 2) {
    return NextResponse.json(
      { error: 'The sitemap is already confirmed. Unapprove it before confirming a new one.' },
      { status: 409 }
    )
  }

  // Persist the confirmed sitemap first — the seeds depend on it being current.
  // Fenced on the updated_at we read: a concurrent confirm that already wrote
  // makes this match zero rows → 409 instead of a second, interleaved reseed.
  const { data: claimed, error: sitemapErr } = await supabase
    .from('content_jobs')
    .update({
      confirmed_sitemap: asJson(pages),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('updated_at', jobRow.updated_at)
    .select('id')
  if (sitemapErr) {
    return internalError('sitemap', sitemapErr, "Couldn't save the sitemap")
  }
  if (!claimed?.length) {
    return NextResponse.json({ error: 'Sitemap was confirmed concurrently — reload and try again.' }, { status: 409 })
  }

  // Clear any existing rows from a previous confirmation. Every delete must
  // succeed, or the reseed below would duplicate/collide with leftovers.
  const deletes = await Promise.all([
    supabase.from('research_results').delete().eq('content_job_id', id),
    supabase.from('page_outlines').delete().eq('content_job_id', id),
    supabase.from('generated_pages').delete().eq('content_job_id', id),
  ])
  const deleteErr = deletes.find((d) => d.error)?.error
  if (deleteErr) {
    console.error('[sitemap] Clearing previous pipeline rows failed:', deleteErr)
    return NextResponse.json({ error: 'Failed to clear previous pipeline rows; retry' }, { status: 500 })
  }

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
    // 23505 = UNIQUE(content_job_id, page_url) (migration 076): a concurrent
    // confirm seeded the same pages. Conflict, not a server fault.
    if ([r1.error, r2.error, r3.error].some((e) => e?.code === '23505')) {
      return NextResponse.json(
        { error: 'Pipeline rows already exist for this sitemap (concurrent confirm) — reload.' },
        { status: 409 }
      )
    }
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
    return internalError('sitemap:approve', phaseErr, "Couldn't approve the sitemap")
  }

  console.warn(`[content-job] phase 2→3 session=${id} pages=${pages.length}`)

  // Get the session_id for the research pipeline
  const { data: jobData } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()

  // Advisory content-readiness check: if the content-critical MBP fields are still
  // thin, the copy will come out generic. Surface it to the operator (non-blocking
  // — generation still proceeds) so a hollow profile is a visible warning rather
  // than a silent quality hit.
  let readiness: { ready: boolean; missing: string[] } = { ready: true, missing: [] }
  if (jobData) {
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', jobData.session_id)
      .single()
    readiness = assessContentReadiness((sessionRow?.schema_data ?? {}) as SessionSchema)
    if (!readiness.ready) {
      console.warn(
        `[content-readiness] session=${jobData.session_id} thin before generation: ${readiness.missing.join('; ')}`
      )
    }
  }

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
    after(() =>
      reviewContentForMbpImpact({
        sessionId,
        origin: 'sitemap_confirm',
        sourceRef: 'confirmed sitemap',
        changedText: pages.map(p => `${p.title} — ${p.url}`).join('\n'),
      }).catch(err => console.error('[mbp-impact] sitemap_confirm review failed:', err))
    )
  }

  return NextResponse.json({ success: true, pageCount: pages.length, readiness })
}
