import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { derivePaletteToneSignal } from './palette-tone-signal'
import { validateContent, ANTI_SLOP_RULES } from './anti-slop-validator'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { Json } from '@/types/database'

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
    ? `\n\nIMPORTANT: A previous draft contained these banned phrases — do NOT use them: ${flaggedPhrases.join(', ')}`
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

export async function runContentGeneration(
  contentJobId: string,
  sessionId: string
): Promise<void> {
  const supabase = createServerClient()

  const [{ data: session }, { data: job }] = await Promise.all([
    supabase.from('sessions').select('website_url, schema_data').eq('id', sessionId).single(),
    supabase.from('content_jobs').select('palette').eq('id', contentJobId).single(),
  ])

  if (!session) {
    console.error('[content-gen] Session not found:', sessionId)
    return
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const palette = (job?.palette ?? null) as PaletteData | null

  // Load approved outlines
  const { data: outlines } = await supabase
    .from('page_outlines')
    .select('id, page_url, page_title, h1, sections, target_keyword, admin_approved')
    .eq('content_job_id', contentJobId)
    .eq('admin_approved', true)
    .order('created_at', { ascending: true })

  if (!outlines?.length) {
    console.warn('[content-gen] No approved outlines for job:', contentJobId)
    return
  }

  // Process sequentially
  for (const outline of outlines) {
    const { data: genPage } = await supabase
      .from('generated_pages')
      .select('id, generation_status')
      .eq('content_job_id', contentJobId)
      .eq('page_url', outline.page_url)
      .single()

    if (!genPage || genPage.generation_status === 'complete') continue

    await supabase
      .from('generated_pages')
      .update({ generation_status: 'running' })
      .eq('id', genPage.id)

    // Load research for this page
    const { data: research } = await supabase
      .from('research_results')
      .select('target_keyword, secondary_keywords, competitor_references, existing_content')
      .eq('content_job_id', contentJobId)
      .eq('page_url', outline.page_url)
      .single()

    const targetKeyword = outline.target_keyword ?? research?.target_keyword ?? outline.page_title.toLowerCase()
    const secondaryKeywords = (research?.secondary_keywords as string[]) ?? []
    const competitorRefs = (research?.competitor_references as Array<{ url: string; title: string; excerpt: string }>) ?? []
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
        session.website_url
      )

      // Anti-slop validation
      const validation = validateContent(result.content)
      if (!validation.passed) {
        console.log(`[content-gen] Anti-slop flagged ${outline.page_url}: ${validation.flagged.join(', ')} — retrying`)
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
          validation.flagged
        )
      }

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
          generation_status: 'complete',
        })
        .eq('id', genPage.id)

      console.log(`[content-gen] Complete: ${outline.page_title}`)
    } catch (err) {
      console.error(`[content-gen] Error on ${outline.page_url}:`, err)
      await supabase
        .from('generated_pages')
        .update({ generation_status: 'error' })
        .eq('id', genPage.id)
    }
  }

  // Check completion
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

    // Email notification
    const firmName = schema.business?.name ?? 'Unknown firm'
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL,
          subject: `[CountingFive] Content ready for download — ${firmName}`,
          html: `
            <h2>Content Generation Complete</h2>
            <p><strong>${firmName}</strong></p>
            <p>${completeCount} pages generated${errorCount > 0 ? `, ${errorCount} errors` : ''}.</p>
            <p><a href="${appUrl}/admin/content/${sessionId}">Download content package →</a></p>
          `,
        })
      } catch (emailErr) {
        console.warn('[content-gen] Email notification failed:', emailErr)
      }
    }
  }
}
