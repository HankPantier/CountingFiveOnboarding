import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { derivePaletteToneSignal } from './palette-tone-signal'
import { buildFirmContext } from './brand-voice'
import { cleanHeading } from './anti-slop-validator'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { buildCachedMessages, extractCacheUsage } from './cache-control'
import { OUTLINE_PROVIDER_OPTIONS } from './generation-tuning'
import { OUTLINE_FALLBACK_NOTE, buildOutlineFailureNote } from './outline-fallback'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { AuditResult } from '@/types/audit-result'
import { asJson } from '@/lib/supabase/json-typed'

const OUTLINE_MODEL = 'claude-sonnet-5'

// Strip scheme + trailing slash so a sitemap's http:// URL still matches the
// crawler's final https:// URL for the same page.
const normUrl = (u: string) =>
  u.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()

type AuditPageSummary = NonNullable<AuditResult['page_analysis_summary']>[number]

// Build a normalized-URL → per-page audit summary lookup once per job so the
// batch loop doesn't linear-scan page_analysis_summary for every page (O(n²)).
export function buildAuditPageIndex(auditResult: AuditResult | null): Map<string, AuditPageSummary> {
  const index = new Map<string, AuditPageSummary>()
  for (const p of auditResult?.page_analysis_summary ?? []) {
    if (!index.has(normUrl(p.url))) index.set(normUrl(p.url), p)
  }
  return index
}

type OutlineResult = {
  h1: string
  sections: Array<{ h2: string; description: string; word_count: number }>
  target_keyword: string
  notes?: string
}

export async function generateOutlineForPage(
  outlineId: string,
  pageTitle: string,
  pageUrl: string,
  contentJobId: string,
  sessionId: string,
  schema: SessionSchema,
  palette: PaletteData | null,
  auditResult: AuditResult | null = null,
  auditPageByUrl?: Map<string, AuditPageSummary>
): Promise<void> {
  const supabase = createServerClient()

  // Load research results for this page
  const { data: research } = await supabase
    .from('research_results')
    .select('target_keyword, secondary_keywords, competitor_references, existing_content')
    .eq('content_job_id', contentJobId)
    .eq('page_url', pageUrl)
    .limit(1)
    .maybeSingle()

  const targetKeyword = research?.target_keyword ?? pageTitle.toLowerCase()
  const secondaryKeywords = (research?.secondary_keywords as string[]) ?? []
  const competitorRefs = (research?.competitor_references as Array<{ url: string; title: string; excerpt: string }>) ?? []
  const existingContent = research?.existing_content ?? ''

  const paletteTone = derivePaletteToneSignal(palette)

  const competitorExcerpts = truncateToTokenBudget(
    competitorRefs
      .slice(0, 3)
      .map(c => `[${c.title}] (${c.url})\n${c.excerpt?.slice(0, 500) ?? ''}`)
      .join('\n\n'),
    600
  )

  // Site-wide content gaps from the audit (if the session came from one).
  const cg = schema.content_gaps
  const gapsBlock =
    cg && (cg.authorityGaps?.length || cg.conversionGaps?.length || cg.nicheGaps?.length || cg.teamExpertiseGaps?.length)
      ? [
          'SITE AUDIT — CONTENT GAPS (address where relevant to this page):',
          cg.conversionGaps?.length ? `Conversion: ${cg.conversionGaps.slice(0, 5).join('; ')}` : '',
          cg.authorityGaps?.length ? `Depth/authority: ${cg.authorityGaps.slice(0, 5).join('; ')}` : '',
          cg.nicheGaps?.length ? `Coverage: ${cg.nicheGaps.slice(0, 5).join('; ')}` : '',
          cg.teamExpertiseGaps?.length ? `Team expertise to leverage: ${cg.teamExpertiseGaps.slice(0, 5).join('; ')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : ''

  // Per-page audit findings — what's wrong with this exact page today. Prefer
  // the prebuilt index (O(1)); fall back to a scan for standalone callers.
  const auditedPage = auditPageByUrl
    ? auditPageByUrl.get(normUrl(pageUrl))
    : auditResult?.page_analysis_summary?.find(p => normUrl(p.url) === normUrl(pageUrl))
  const auditHintsBlock = auditedPage
    ? [
        'SITE AUDIT — THIS PAGE TODAY (the rewrite must fix these):',
        `Current length: ${auditedPage.word_count} words${auditedPage.word_count < 300 ? ' (thin — expand substantially)' : ''}`,
        auditedPage.issues.length ? `Issues: ${auditedPage.issues.slice(0, 6).join('; ')}` : '',
        auditedPage.suggested_title ? `Suggested title: ${auditedPage.suggested_title}` : '',
        auditedPage.suggested_meta ? `Suggested meta: ${auditedPage.suggested_meta}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  // Static, job-constant prefix (firm context + site-wide content gaps + the
  // output/rules spec). Cache breakpoint via buildCachedMessages so every page
  // outline in a job reuses it as a cache read. Per-page inputs live in
  // dynamicSuffix below — keep every per-page value OUT of this string.
  const staticPrefix = `You are a website content strategist for a CPA firm. Generate a structured page outline — not copy, just structure.

FIRM CONTEXT:
Brand voice: ${schema.brand?.currentTone ?? 'professional and approachable'}
Positioning: ${schema.business?.positioningOption ?? ''} — ${schema.business?.positioningStatement?.slice(0, 200) ?? ''}
Differentiators: ${schema.business?.differentiators ?? 'Not specified'}
Niches: ${schema.niches?.map(n => n.name).join(', ') ?? 'General CPA services'}
${paletteTone ? `Palette tone: ${paletteTone}` : ''}

${buildFirmContext(schema)}

${gapsBlock}

OUTPUT FORMAT (JSON only, no prose):
{
  "h1": "...",
  "sections": [
    { "h2": "...", "description": "One sentence: what this section covers and why it matters for this audience.", "word_count": 150 }
  ],
  "target_keyword": "...",
  "notes": "Optional: anything the copywriter should know about tone or angle for this page."
}

RULES:
- 4–7 sections per page (fewer for simple pages, more for comprehensive service pages)
- H1 must contain or closely relate to the target keyword
- Section descriptions are for the copywriter — be specific about angle, not just topic
- Word counts should total 600–1200 words for standard pages, 1500–2000 for pillar pages
- Do not write any actual copy — structure only

HEADING RULES (h1 and every h2):
- Specific and benefit-driven, in sentence case
- No parenthetical subtitles, e.g. "(Beyond the Buzzwords)"
- No colon-cliché subtitles ("A Deep Dive", "A Complete/Ultimate Guide", "Everything You Need to Know")
- Never "What X Actually Means", "Beyond the …", "The Importance of …", "A Closer Look", "Demystifying/Decoding/Unpacking", or listicle titles ("5 Reasons …")
- No dashes (— or –) in any heading`

  // Per-page dynamic suffix — everything that varies per page, kept out of the
  // cached prefix.
  const dynamicSuffix = `PAGE: ${pageTitle} (${pageUrl})
TARGET KEYWORD: ${targetKeyword}
SECONDARY KEYWORDS: ${secondaryKeywords.join(', ')}

${existingContent ? `EXISTING CONTENT (current site — improve on this):\n${existingContent.slice(0, 800)}` : ''}

${competitorExcerpts ? `COMPETITOR REFERENCES (SERP top results — differentiate from these):\n${competitorExcerpts}` : ''}

${auditHintsBlock}`

  const { text, usage, finishReason } = await generateText({
    model: anthropic(OUTLINE_MODEL),
    messages: buildCachedMessages(staticPrefix, dynamicSuffix),
    // Ample headroom for adaptive-thinking tokens ahead of the JSON answer. 3000
    // truncated the answer once thinking ran, collapsing pages into the fallback.
    maxOutputTokens: 8000,
    providerOptions: OUTLINE_PROVIDER_OPTIONS,
    maxRetries: 4,
  })

  const cache = extractCacheUsage(usage)
  console.warn(
    `[outline-gen] page="${pageUrl}" input=${usage?.inputTokens ?? '?'} output=${usage?.outputTokens ?? '?'} cacheRead=${cache.cacheReadInputTokens} cacheWrite=${cache.cacheCreationInputTokens} finish=${finishReason}`
  )
  checkTokenBudget('outline', pageUrl, usage?.inputTokens, 3000)
  await recordTokenUsage({
    task: 'content',
    contentJobId,
    sessionId,
    stage: 'outline',
    pageUrl,
    model: OUTLINE_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadInputTokens: cache.cacheReadInputTokens,
    cacheCreationInputTokens: cache.cacheCreationInputTokens,
  })

  let outline: OutlineResult
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    outline = JSON.parse(cleaned)
    // Claude occasionally emits sections as the literal string "[]" instead of
    // an actual array. Coerce any non-array shape to the fallback so the row
    // is never written with a malformed sections value.
    if (!Array.isArray(outline.sections)) {
      console.warn(`[outline-gen] Non-array sections for ${pageUrl} — using fallback`)
      outline.sections = [{ h2: 'Overview', description: 'Add content here', word_count: 300 }]
      outline.notes = OUTLINE_FALLBACK_NOTE
    }
  } catch (err) {
    // A 'length' finishReason means the model hit maxOutputTokens before closing
    // the JSON — surface it so truncation is diagnosable rather than silently
    // collapsing into the single-section placeholder.
    console.warn(
      `[outline-gen] Failed to parse outline JSON for ${pageUrl} (finish=${finishReason}): ${err instanceof Error ? err.message : String(err)} — using fallback`
    )
    outline = {
      h1: pageTitle,
      sections: [{ h2: 'Overview', description: 'Add content here', word_count: 300 }],
      target_keyword: targetKeyword,
      notes: OUTLINE_FALLBACK_NOTE,
    }
  }

  // Humanize headings at the source so page generation inherits clean titles
  // (strip parenthetical subtitles, normalize dashes). Admins still review before approval.
  if (typeof outline.h1 === 'string') outline.h1 = cleanHeading(outline.h1)
  outline.sections = outline.sections.map(s =>
    typeof s.h2 === 'string' ? { ...s, h2: cleanHeading(s.h2) } : s
  )

  await supabase
    .from('page_outlines')
    .update({
      h1: outline.h1,
      sections: asJson(outline.sections),
      target_keyword: outline.target_keyword ?? targetKeyword,
      admin_notes: outline.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', outlineId)
}

export async function runOutlineGeneration(
  contentJobId: string,
  sessionId: string
): Promise<void> {
  const supabase = createServerClient()

  // Load session, job, and the audit this session was seeded from (if any) so
  // each outline can target the audit's per-page findings. Only the source
  // audit is linked via session_id (re-audits are unlinked), so this is the
  // baseline "before" snapshot.
  const [{ data: session }, { data: job }, { data: auditRun, error: auditErr }] = await Promise.all([
    supabase.from('sessions').select('schema_data').eq('id', sessionId).single(),
    supabase.from('content_jobs').select('palette').eq('id', contentJobId).single(),
    supabase
      .from('audit_runs')
      .select('result')
      .eq('session_id', sessionId)
      .eq('audit_status', 'complete')
      .maybeSingle(),
  ])

  if (auditErr) console.warn('[outline-gen] audit lookup failed:', auditErr.message)
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const palette = (job?.palette ?? null) as PaletteData | null
  const auditResult = (auditRun?.result ?? null) as AuditResult | null

  // Load all outlines for this job
  const { data: outlines } = await supabase
    .from('page_outlines')
    .select('id, page_url, page_title, h1')
    .eq('content_job_id', contentJobId)
    .order('created_at', { ascending: true })

  if (!outlines?.length) {
    console.warn('[outline-gen] No outlines found for job:', contentJobId)
    return
  }

  // Process in small parallel batches with a soft deadline + self-chain, mirroring
  // the page-body generator (runContentGeneration). A single 120s/300s invocation
  // could not finish a 40+ page job sequentially and got killed mid-run, leaving
  // most rows with null h1 ("still generating") and nothing to resume them. The
  // `!o.h1` filter makes this idempotent, so a chained continuation picks up
  // exactly where the prior invocation was cut off.
  const BATCH_SIZE = 3
  const SOFT_DEADLINE_MS = 240_000
  const startedAt = Date.now()
  let completedThisRun = 0

  const auditPageByUrl = buildAuditPageIndex(auditResult)
  const pending = outlines.filter(o => !o.h1)
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      console.warn(`[outline-gen] Soft deadline reached after ${i} pages, chaining continuation.`)
      break
    }
    const batch = pending.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (outline) => {
      try {
        await generateOutlineForPage(
          outline.id,
          outline.page_title,
          outline.page_url,
          contentJobId,
          sessionId,
          schema,
          palette,
          auditResult,
          auditPageByUrl
        )
      } catch (err) {
        console.error(`[outline-gen] Error generating outline for ${outline.page_url}:`, err)
        // Store a review-flagged fallback carrying the real error so the operator
        // sees the cause (isFallbackOutline recognizes the prefix → "Needs review").
        await supabase
          .from('page_outlines')
          .update({
            h1: outline.page_title,
            sections: asJson([{ h2: 'Overview', description: 'Add content here', word_count: 300 }]),
            admin_notes: buildOutlineFailureNote(err),
            updated_at: new Date().toISOString(),
          })
          .eq('id', outline.id)
      }
      // A fallback write still sets h1, so the row is no longer "still generating"
      // and this counts as forward progress for the chain guard below.
      completedThisRun += 1
    }))
  }

  // Re-query the true remaining count so a chained continuation reasons about the
  // live state, not this invocation's stale snapshot.
  const { data: remaining } = await supabase
    .from('page_outlines')
    .select('id')
    .eq('content_job_id', contentJobId)
    .is('h1', null)
  const remainingCount = remaining?.length ?? 0

  if (remainingCount > 0) {
    // Guard against an infinite cascade: only chain when this run made progress.
    if (completedThisRun === 0) {
      console.warn(`[outline-gen] ${remainingCount} pages remain but no progress this run — not chaining.`)
      return
    }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    const cronSecret = process.env.CRON_SECRET
    if (!baseUrl || !cronSecret) {
      console.warn('[outline-gen] Auto-chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.')
      return
    }
    const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
    try {
      const res = await fetch(`${url}/api/content-jobs/${contentJobId}/outlines/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      console.warn(`[outline-gen] Chained continuation: completed=${completedThisRun} this run, status=${res.status}`)
    } catch (err) {
      console.error('[outline-gen] Auto-chain self-call failed:', err)
    }
    return
  }

  console.warn(`[content-job] Outlines generated for job=${contentJobId}`)

  // Final invocation — every page is written. Send the "ready for review" email once.
  const firmName = schema.business?.name ?? 'Unknown firm'
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL,
        subject: `[Revaltus] Outlines ready for review — ${firmName}`,
        html: `
          <h2>Outlines Ready for Review</h2>
          <p><strong>${firmName}</strong></p>
          <p>${outlines.length} page outlines are ready for your review.</p>
          <p><a href="${appUrl}/admin/content/${sessionId}">Review outlines →</a></p>
        `,
      })
    } catch (emailErr) {
      console.warn('[outline-gen] Email notification failed:', emailErr)
    }
  }
}
