import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { derivePaletteToneSignal } from './palette-tone-signal'
import { validateContent, ANTI_SLOP_RULES } from './anti-slop-validator'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import { countWords, targetWordCount } from './word-count-validator'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { Json } from '@/types/database'

type Cta = { text: string; url: string }
const DEFAULT_CTA: Cta = { text: 'Schedule a consultation', url: '/contact' }

type GeneratedResult = {
  content: string
  metadata: {
    meta_title: string
    meta_description: string
    target_keyword: string
    secondary_keywords: string[]
    url_slug: string
    canonical_url: string
    answer_block: string
    schema_markup_type: string
    eeat_signals: string[]
    internal_links: Array<{ url: string; anchor_text: string; reason: string }>
    faq_block: Array<{ question: string; answer: string }>
    llm_citation_note: string
  }
}

function buildCredentials(schema: SessionSchema): string {
  const creds: string[] = []
  for (const member of schema.team ?? []) {
    if (member.certifications?.length) {
      creds.push(`${member.name}: ${member.certifications.join(', ')}`)
    }
  }
  for (const aff of schema.business?.affiliations ?? []) {
    creds.push(aff)
  }
  return creds.join('\n') || 'Not specified'
}

function normalizeCta(raw: unknown): Cta {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    const text = typeof r.text === 'string' && r.text.trim() ? r.text : DEFAULT_CTA.text
    const url = typeof r.url === 'string' && r.url.trim() ? r.url : DEFAULT_CTA.url
    return { text, url }
  }
  return DEFAULT_CTA
}

async function generatePageContent(
  pageTitle: string,
  pageUrl: string,
  outlineSections: Json,
  targetKeyword: string,
  secondaryKeywords: string[],
  existingContent: string | null,
  competitorRefs: Array<{ url: string; title: string; excerpt: string }>,
  schema: SessionSchema,
  palette: PaletteData | null,
  websiteUrl: string,
  cta: Cta,
  flaggedPhrases?: string[]
): Promise<GeneratedResult> {
  const firmName = schema.business?.name ?? 'the firm'
  const location = schema.locations?.[0]
    ? `${schema.locations[0].city}, ${schema.locations[0].state}`
    : ''
  const paletteTone = derivePaletteToneSignal(palette)

  const competitorExcerpts = truncateToTokenBudget(
    competitorRefs
      .slice(0, 3)
      .map(c => `[${c.title}] (${c.url})\n${c.excerpt?.slice(0, 400) ?? ''}`)
      .join('\n\n'),
    800
  )

  const retryNote = flaggedPhrases?.length
    ? `\n\nIMPORTANT: A previous draft was flagged for these issues — fix all of them: ${flaggedPhrases.join(' | ')}`
    : ''

  const prompt = `You are writing website copy for ${firmName}, a CPA firm in ${location}.

BRAND VOICE:
${schema.brand?.currentTone ?? 'Professional and approachable'} | Aspirational: ${schema.brand?.aspirationalTone ?? ''}
Tone adjectives: ${schema.brand?.toneAdjectives?.join(', ') ?? ''}
Avoid: ${schema.brand?.toneToAvoid?.join(', ') ?? ''}
Positioning: ${schema.business?.positioningOption ?? ''} — ${schema.business?.positioningStatement?.slice(0, 300) ?? ''}

PALETTE TONE: ${paletteTone}

DIFFERENTIATORS (use these specifically, do not generalize):
${schema.business?.differentiators ?? 'Not specified'}

CREDENTIALS TO FEATURE:
${buildCredentials(schema)}

PAGE TO WRITE:
Title: ${pageTitle}
URL: ${pageUrl}
Approved outline: ${JSON.stringify(outlineSections)}

KEYWORD TARGET:
Primary: ${targetKeyword}
Secondary: ${secondaryKeywords.join(', ')}

PAGE CTA — close every page with a clear call-to-action that points to this. Weave it into the closing paragraph or render it as a final standalone block:
Text: "${cta.text}"
URL: ${cta.url}

${existingContent ? `EXISTING CONTENT ON THIS TOPIC (rewrite and improve — do not copy):\n${truncateToTokenBudget(existingContent, 800)}` : ''}

${competitorExcerpts ? `COMPETITOR REFERENCES (differentiate from these — do not imitate):\n${competitorExcerpts}` : ''}

OUTPUT: Return a JSON object with two keys:
1. "content" — the full page copy in markdown. Use ## for H2s matching the approved outline. Write naturally, as if for a human reader first, search engine second.
2. "metadata" — a JSON object with these fields:
   - meta_title (50-60 chars, contains primary keyword)
   - meta_description (150-160 chars, compelling + keyword)
   - target_keyword
   - secondary_keywords (array)
   - url_slug (final recommended slug)
   - canonical_url (full URL: https://${websiteUrl.replace(/^https?:\/\//, '')}${pageUrl})
   - answer_block (2-3 sentences answering the likely search query directly)
   - schema_markup_type (e.g. "LocalBusiness", "Service", "FAQPage")
   - eeat_signals (array of specific credential/experience claims)
   - internal_links (array of {url, anchor_text, reason} — reference other pages in the site)
   - faq_block (array of {question, answer} — 40-60 words per answer)
   - llm_citation_note (what structured claim an AI tool would most likely cite)

${ANTI_SLOP_RULES}${retryNote}`

  const { text, usage } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    prompt,
    maxOutputTokens: 4000,
  })

  console.log(
    `[content-gen] page="${pageUrl}" input=${usage?.inputTokens ?? '?'} output=${usage?.outputTokens ?? '?'}`
  )
  checkTokenBudget('content', pageUrl, usage?.inputTokens, 5000)

  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      content: parsed.content ?? '',
      metadata: {
        meta_title: parsed.metadata?.meta_title ?? pageTitle,
        meta_description: parsed.metadata?.meta_description ?? '',
        target_keyword: parsed.metadata?.target_keyword ?? targetKeyword,
        secondary_keywords: parsed.metadata?.secondary_keywords ?? secondaryKeywords,
        url_slug: parsed.metadata?.url_slug ?? pageUrl,
        canonical_url: parsed.metadata?.canonical_url ?? '',
        answer_block: parsed.metadata?.answer_block ?? '',
        schema_markup_type: parsed.metadata?.schema_markup_type ?? 'WebPage',
        eeat_signals: parsed.metadata?.eeat_signals ?? [],
        internal_links: parsed.metadata?.internal_links ?? [],
        faq_block: parsed.metadata?.faq_block ?? [],
        llm_citation_note: parsed.metadata?.llm_citation_note ?? '',
      },
    }
  } catch {
    console.error(`[content-gen] Failed to parse JSON for ${pageUrl}, storing raw text`)
    return {
      content: text,
      metadata: {
        meta_title: pageTitle,
        meta_description: '',
        target_keyword: targetKeyword,
        secondary_keywords: secondaryKeywords,
        url_slug: pageUrl,
        canonical_url: '',
        answer_block: '',
        schema_markup_type: 'WebPage',
        eeat_signals: [],
        internal_links: [],
        faq_block: [],
        llm_citation_note: '',
      },
    }
  }
}

// Generate (or regenerate) a single page from its already-approved outline.
// Used by both the bulk runContentGeneration loop and the per-page regenerate
// endpoint. Resets admin_approved_content to false on success so the admin
// re-reviews any newly produced copy.
export async function generateSinglePage(
  contentJobId: string,
  outlineId: string
): Promise<{ status: 'complete' | 'error'; pageUrl: string; error?: string }> {
  const supabase = createServerClient()

  const { data: outline, error: outlineErr } = await supabase
    .from('page_outlines')
    .select('id, page_url, page_title, sections, target_keyword, admin_approved, cta')
    .eq('id', outlineId)
    .single()

  if (outlineErr || !outline) {
    return { status: 'error', pageUrl: '', error: outlineErr?.message ?? 'Outline not found' }
  }

  // Load the rest of the context.
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, palette')
    .eq('id', contentJobId)
    .single()
  if (!job) return { status: 'error', pageUrl: outline.page_url, error: 'Content job not found' }

  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', job.session_id)
    .single()
  if (!session) return { status: 'error', pageUrl: outline.page_url, error: 'Session not found' }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const palette = (job.palette ?? null) as PaletteData | null
  const cta = normalizeCta(outline.cta)

  const { data: genPage } = await supabase
    .from('generated_pages')
    .select('id')
    .eq('content_job_id', contentJobId)
    .eq('page_url', outline.page_url)
    .single()
  if (!genPage) return { status: 'error', pageUrl: outline.page_url, error: 'generated_pages row missing' }

  await supabase
    .from('generated_pages')
    .update({ generation_status: 'running' })
    .eq('id', genPage.id)

  const { data: research } = await supabase
    .from('research_results')
    .select('target_keyword, secondary_keywords, competitor_references, existing_content')
    .eq('content_job_id', contentJobId)
    .eq('page_url', outline.page_url)
    .single()

  const targetKeyword =
    outline.target_keyword ?? research?.target_keyword ?? outline.page_title.toLowerCase()
  const secondaryKeywords = (research?.secondary_keywords as string[]) ?? []
  const competitorRefs =
    (research?.competitor_references as Array<{ url: string; title: string; excerpt: string }>) ?? []
  const existingContent = research?.existing_content ?? null

  try {
    let result = await generatePageContent(
      outline.page_title,
      outline.page_url,
      outline.sections,
      targetKeyword,
      secondaryKeywords,
      existingContent,
      competitorRefs,
      schema,
      palette,
      session.website_url,
      cta
    )

    const validation = validateContent(result.content)
    if (!validation.passed) {
      console.log(
        `[content-gen] Anti-slop flagged ${outline.page_url}: ${validation.flagged.join(' | ')} — retrying`
      )
      result = await generatePageContent(
        outline.page_title,
        outline.page_url,
        outline.sections,
        targetKeyword,
        secondaryKeywords,
        existingContent,
        competitorRefs,
        schema,
        palette,
        session.website_url,
        cta,
        validation.flagged
      )
    }

    const sections = (outline.sections as Array<{ word_count?: number }>) ?? []
    const wcTarget = targetWordCount(sections)
    const wcActual = countWords(result.content)

    await supabase
      .from('generated_pages')
      .update({
        content_markdown: result.content,
        meta_title: result.metadata.meta_title,
        meta_description: result.metadata.meta_description,
        target_keyword: result.metadata.target_keyword,
        secondary_keywords: result.metadata.secondary_keywords as unknown as Json,
        url_slug: result.metadata.url_slug,
        canonical_url: result.metadata.canonical_url,
        answer_block: result.metadata.answer_block,
        schema_markup_type: result.metadata.schema_markup_type,
        eeat_signals: result.metadata.eeat_signals as unknown as Json,
        internal_links: result.metadata.internal_links as unknown as Json,
        faq_block: result.metadata.faq_block as unknown as Json,
        llm_citation_note: result.metadata.llm_citation_note,
        word_count_actual: wcActual,
        word_count_target: wcTarget || null,
        admin_approved_content: false,  // re-review required after every generation
        generation_status: 'complete',
      })
      .eq('id', genPage.id)

    console.log(`[content-gen] Complete: ${outline.page_title} (${wcActual} words / target ${wcTarget})`)
    return { status: 'complete', pageUrl: outline.page_url }
  } catch (err) {
    console.error(`[content-gen] Error on ${outline.page_url}:`, err)
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('generated_pages')
      .update({ generation_status: 'error' })
      .eq('id', genPage.id)
    return { status: 'error', pageUrl: outline.page_url, error: message }
  }
}

export async function runContentGeneration(
  contentJobId: string,
  sessionId: string
): Promise<void> {
  const supabase = createServerClient()

  // Load approved outlines (per-page generation pulls its own context).
  const { data: outlines } = await supabase
    .from('page_outlines')
    .select('id, page_url')
    .eq('content_job_id', contentJobId)
    .eq('admin_approved', true)
    .order('created_at', { ascending: true })

  if (!outlines?.length) {
    console.warn('[content-gen] No approved outlines for job:', contentJobId)
    return
  }

  for (const outline of outlines) {
    // Skip pages already complete to make this loop idempotent on re-run.
    const { data: genPage } = await supabase
      .from('generated_pages')
      .select('generation_status')
      .eq('content_job_id', contentJobId)
      .eq('page_url', outline.page_url)
      .single()
    if (genPage?.generation_status === 'complete') continue

    await generateSinglePage(contentJobId, outline.id)
  }

  // Check completion + advance phase + email notification.
  const { data: allPages } = await supabase
    .from('generated_pages')
    .select('generation_status')
    .eq('content_job_id', contentJobId)

  const allDone = allPages?.every(p => p.generation_status === 'complete' || p.generation_status === 'error')
  const completeCount = allPages?.filter(p => p.generation_status === 'complete').length ?? 0
  const errorCount = allPages?.filter(p => p.generation_status === 'error').length ?? 0

  if (allDone) {
    await supabase
      .from('content_jobs')
      .update({ phase: 6, updated_at: new Date().toISOString() })
      .eq('id', contentJobId)

    console.log(`[content-job] phase 5→6 session=${sessionId} complete=${completeCount} errors=${errorCount}`)

    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', sessionId)
      .single()
    const schema = (session?.schema_data ?? {}) as SessionSchema
    const firmName = schema.business?.name ?? 'Unknown firm'

    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL,
          subject: `[CountingFive] Content ready for review — ${firmName}`,
          html: `
            <h2>Content Generation Complete</h2>
            <p><strong>${firmName}</strong></p>
            <p>${completeCount} pages generated${errorCount > 0 ? `, ${errorCount} errors` : ''}.</p>
            <p><a href="${appUrl}/admin/content/${sessionId}">Review and approve before download →</a></p>
          `,
        })
      } catch (emailErr) {
        console.warn('[content-gen] Email notification failed:', emailErr)
      }
    }
  }
}
