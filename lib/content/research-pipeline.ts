import { createServerClient } from '@/lib/supabase/server'
import { runKeywordResearch } from './keyword-research'
import { fetchCompetitorPages, fetchExistingContent } from './competitor-fetch'
import { runOutlineGeneration } from './outline-generator'
import type { SessionSchema } from '@/types/session-schema'
import { asJson } from '@/lib/supabase/json-typed'

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

  const schema = session.schema_data as SessionSchema
  const firmContext = {
    name: schema.business?.name ?? '',
    location: schema.locations?.[0]
      ? `${schema.locations[0].city}, ${schema.locations[0].state}`
      : '',
    services: schema.services?.map(s => s.name) ?? [],
    niches: schema.niches?.map(n => n.name) ?? [],
  }
  const currentSitemap = schema.current_sitemap

  // Process pages in batches of 3
  const BATCH_SIZE = 3
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (page) => {
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

      // Mark as running
      await supabase
        .from('research_results')
        .update({ research_status: 'running', updated_at: new Date().toISOString() })
        .eq('id', researchRow.id)

      try {
        // Job 1: Keyword research
        console.warn(`[Research] Starting keyword research for: ${page.title}`)
        const keywords = await runKeywordResearch(page.title, page.url, firmContext, {
          contentJobId,
          sessionId,
        })

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
    }))
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
    await supabase
      .from('content_jobs')
      .update({ phase: 4, updated_at: new Date().toISOString() })
      .eq('id', contentJobId)

    console.warn(`[content-job] phase 3→4 session=${sessionId} complete=${completeCount} errors=${errorCount}`)

    // Fire outline generation automatically
    runOutlineGeneration(contentJobId, sessionId).catch(err =>
      console.error('[outline-gen] Pipeline failed:', err)
    )

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
