import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { derivePaletteToneSignal } from './palette-tone-signal'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { Json } from '@/types/database'

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
  schema: SessionSchema,
  palette: PaletteData | null
): Promise<void> {
  const supabase = createServerClient()

  // Load research results for this page
  const { data: research } = await supabase
    .from('research_results')
    .select('target_keyword, secondary_keywords, competitor_references, existing_content')
    .eq('content_job_id', contentJobId)
    .eq('page_url', pageUrl)
    .single()

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

  const prompt = `You are a website content strategist for a CPA firm. Generate a structured page outline — not copy, just structure.

FIRM CONTEXT:
Brand voice: ${schema.brand?.currentTone ?? 'professional and approachable'}
Positioning: ${schema.business?.positioningOption ?? ''} — ${schema.business?.positioningStatement?.slice(0, 200) ?? ''}
Differentiators: ${schema.business?.differentiators ?? 'Not specified'}
Niches: ${schema.niches?.map(n => n.name).join(', ') ?? 'General CPA services'}
${paletteTone ? `Palette tone: ${paletteTone}` : ''}

PAGE: ${pageTitle} (${pageUrl})
TARGET KEYWORD: ${targetKeyword}
SECONDARY KEYWORDS: ${secondaryKeywords.join(', ')}

${existingContent ? `EXISTING CONTENT (current site — improve on this):\n${existingContent.slice(0, 800)}` : ''}

${competitorExcerpts ? `COMPETITOR REFERENCES (SERP top results — differentiate from these):\n${competitorExcerpts}` : ''}

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
- Do not write any actual copy — structure only`

  const { text, usage } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    prompt,
    maxOutputTokens: 1000,
  })

  console.log(
    `[outline-gen] page="${pageUrl}" input=${usage?.inputTokens ?? '?'} output=${usage?.outputTokens ?? '?'}`
  )
  checkTokenBudget('outline', pageUrl, usage?.inputTokens, 3000)

  let outline: OutlineResult
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    outline = JSON.parse(cleaned)
  } catch {
    // Fallback outline
    console.warn(`[outline-gen] Failed to parse outline JSON for ${pageUrl}, using fallback`)
    outline = {
      h1: pageTitle,
      sections: [{ h2: 'Overview', description: 'Add content here', word_count: 300 }],
      target_keyword: targetKeyword,
      notes: 'Auto-generated fallback — admin must edit before approving.',
    }
  }

  await supabase
    .from('page_outlines')
    .update({
      h1: outline.h1,
      sections: outline.sections as unknown as Json,
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

  // Load session and job data
  const [{ data: session }, { data: job }] = await Promise.all([
    supabase.from('sessions').select('schema_data').eq('id', sessionId).single(),
    supabase.from('content_jobs').select('palette').eq('id', contentJobId).single(),
  ])

  const schema = (session?.schema_data ?? {}) as SessionSchema
  const palette = (job?.palette ?? null) as PaletteData | null

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

  // Process sequentially to manage rate limits
  for (const outline of outlines) {
    // Skip if already generated (has h1)
    if (outline.h1) continue

    try {
      await generateOutlineForPage(
        outline.id,
        outline.page_title,
        outline.page_url,
        contentJobId,
        schema,
        palette
      )
    } catch (err) {
      console.error(`[outline-gen] Error generating outline for ${outline.page_url}:`, err)
      // Store fallback
      await supabase
        .from('page_outlines')
        .update({
          h1: outline.page_title,
          sections: [{ h2: 'Overview', description: 'Add content here', word_count: 300 }] as unknown as Json,
          admin_notes: 'Auto-generated fallback — generation failed. Admin must edit before approving.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', outline.id)
    }
  }

  console.log(`[content-job] Outlines generated for job=${contentJobId}`)

  // Send email notification
  const firmName = schema.business?.name ?? 'Unknown firm'
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL,
        subject: `[CountingFive] Outlines ready for review — ${firmName}`,
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
