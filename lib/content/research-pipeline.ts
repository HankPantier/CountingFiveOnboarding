import { createServerClient } from '@/lib/supabase/server'
import { runKeywordResearch } from './keyword-research'
import { fetchCompetitorPages, fetchExistingContent } from './competitor-fetch'
import { activeNiches } from './active-niches'
import { resolvePageIntent } from './page-intent'
import type { SessionSchema } from '@/types/session-schema'
import { asJson } from '@/lib/supabase/json-typed'
import { createBudget, runWithPool } from './generation-budget'
import { objArr, str } from './schema-coerce'

// Must match the maxDuration of every route that runs runResearchPipeline
// (sitemap confirm, research/retry, research/restart, research/continue).
export const RESEARCH_ROUTE_MAX_DURATION_MS = 300_000
// One page = Serper keyword research + a model call + competitor/existing fetch.
const RESEARCH_MIN_VIABLE_MS = 60_000

type SitemapPage = {
  url: string
  title: string
  status: string
  parent?: string
}

export async function runResearchPipeline(
  contentJobId: string,
  pages: SitemapPage[],
  sessionId: string
): Promise<void> {
  const supabase = createServerClient()

  // Load session data for context
  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', sessionId)
    .single()

  if (!session) {
    console.error('[Research] Session not found:', sessionId)
    return
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  // Coerced reads: a dirty stored shape (string where an array is declared, a
  // null hole in locations) threw here and killed the whole research run.
  const firstLocation = objArr<{ city?: unknown; state?: unknown }>(schema.locations)[0]
  const firmContext = {
    name: str(schema.business?.name),
    location: firstLocation ? `${str(firstLocation.city)}, ${str(firstLocation.state)}` : '',
    services: objArr<{ name?: unknown }>(schema.services).map(s => str(s.name)).filter(Boolean),
    niches: activeNiches(schema).map(n => n.name),
  }
  const currentSitemap = schema.current_sitemap

  // Budgeted pool of 3 (was unbounded batches inside a route with no
  // maxDuration). Pages that don't fit are left 'pending' and the run
  // self-chains to /research/continue; already-complete pages are skipped so a
  // continuation or re-trigger is idempotent.
  const { data: doneRows } = await supabase
    .from('research_results')
    .select('page_url')
    .eq('content_job_id', contentJobId)
    .eq('research_status', 'complete')
  const doneUrls = new Set((doneRows ?? []).map(r => r.page_url))
  const todo = pages.filter(p => !doneUrls.has(p.url))
  const budget = createBudget({ maxDurationMs: RESEARCH_ROUTE_MAX_DURATION_MS, reserveMs: 45_000 })

  const { skipped } = await runWithPool(todo, 3, budget, async (page) => {
      // Find the research_results row for this page
      const { data: researchRow } = await supabase
        .from('research_results')
        .select('id')
        .eq('content_job_id', contentJobId)
        .eq('page_url', page.url)
        .single()

      if (!researchRow) {
        console.warn('[Research] No research_results row for:', page.url)
        return
      }

      // Atomically claim the row: the update only lands when it wasn't already
      // 'running', so two concurrent workers can't double-run the 3 research
      // sub-jobs (mirrors generateSinglePage's `.neq('generation_status','running')`).
      const { data: claimed } = await supabase
        .from('research_results')
        .update({ research_status: 'running', updated_at: new Date().toISOString() })
        .eq('id', researchRow.id)
        .neq('research_status', 'running')
        .select('id')
      if (!claimed || claimed.length === 0) {
        console.warn('[Research] Skipping — already running:', page.url)
        return
      }

      try {
        // Job 1: Keyword research — steer it toward the page's specific niche or
        // service audience when the URL identifies one.
        console.warn(`[Research] Starting keyword research for: ${page.title}`)
        const intent = resolvePageIntent(page.url, page.title, schema)
        const focus =
          intent.niche
            ? { label: intent.niche.name, keywords: intent.niche.keywords ?? [] }
            : intent.service
              ? { label: intent.service.name, keywords: intent.service.keywords ?? [] }
              : undefined
        const keywords = await runKeywordResearch(page.title, page.url, firmContext, {
          contentJobId,
          sessionId,
        }, focus)

        // Job 2: Competitor page analysis
        const competitorRefs = await fetchCompetitorPages(keywords.competitorRefs)

        // Job 3: Existing content extraction
        const existingContent = await fetchExistingContent(
          session.website_url,
          currentSitemap,
          page.url
        )

        // Save results — clear any error_message from a prior failed attempt.
        await supabase
          .from('research_results')
          .update({
            target_keyword: keywords.targetKeyword,
            secondary_keywords: asJson(keywords.secondaryKeywords),
            competitor_references: asJson(competitorRefs),
            existing_content: existingContent,
            research_status: 'complete',
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', researchRow.id)

        console.warn(`[Research] Complete: ${page.title} → "${keywords.targetKeyword}"`)
      } catch (err) {
        console.error(`[Research] Error on ${page.url}:`, err)
        const message = err instanceof Error ? err.message : String(err)
        await supabase
          .from('research_results')
          .update({
            research_status: 'error',
            error_message: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', researchRow.id)
      }
  }, RESEARCH_MIN_VIABLE_MS)

  if (skipped.length) {
    console.warn(`[Research] Budget reached with ${skipped.length} page(s) left — chaining continuation.`)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    const cronSecret = process.env.CRON_SECRET
    if (baseUrl && cronSecret) {
      const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
      try {
        await fetch(`${url}/api/content-jobs/${contentJobId}/research/continue`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
      } catch (err) {
        console.error('[Research] Chain failed (cron will resume):', err)
      }
    }
    return
  }

  // Check if all done — advance phase
  const { data: allResults } = await supabase
    .from('research_results')
    .select('research_status')
    .eq('content_job_id', contentJobId)

  const allDone = allResults?.every(r => r.research_status === 'complete' || r.research_status === 'error')
  const completeCount = allResults?.filter(r => r.research_status === 'complete').length ?? 0
  const errorCount = allResults?.filter(r => r.research_status === 'error').length ?? 0

  if (allDone) {
    // Only a job still in research advances (a concurrent/late run must not
    // pull a job back to phase 4 from later phases).
    const { data: advanced } = await supabase
      .from('content_jobs')
      .update({ phase: 4, updated_at: new Date().toISOString() })
      .eq('id', contentJobId)
      .eq('phase', 3)
      .select('id')
    if (!advanced?.length) return

    console.warn(`[content-job] phase 3→4 session=${sessionId} complete=${completeCount} errors=${errorCount}`)

    // Kick off outline generation via an HTTP self-call so it runs as its own
    // Vercel invocation (the generate route sets maxDuration 300 and wraps the
    // work in after()). A bare fire-and-forget here would be an unawaited promise
    // dangling inside the sitemap route's after() budget and could be cut off,
    // stranding outline rows at h1 = null with no cron to resume them.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    const cronSecret = process.env.CRON_SECRET
    if (baseUrl && cronSecret) {
      const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
      try {
        await fetch(`${url}/api/content-jobs/${contentJobId}/outlines/generate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
      } catch (err) {
        console.error('[outline-gen] Trigger failed:', err)
      }
    } else {
      console.warn('[outline-gen] Auto-start skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.')
    }

    // Send email notification (skip if Resend not configured)
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL,
          subject: `[Revaltus] Research complete — ${firmContext.name}`,
          html: `
            <h2>Research Pipeline Complete</h2>
            <p><strong>${firmContext.name}</strong></p>
            <p>${completeCount} pages researched${errorCount > 0 ? `, ${errorCount} errors` : ''}.</p>
            <p><a href="${appUrl}/admin/content/${sessionId}">Review outlines →</a></p>
          `,
        })
      } catch (emailErr) {
        console.warn('[Research] Email notification failed:', emailErr)
      }
    }
  }
}
