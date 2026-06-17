import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { derivePaletteToneSignal } from './palette-tone-signal'
import { validateContent, ANTI_SLOP_RULES, humanizeDashes } from './anti-slop-validator'
import { parseBlockAnnotations, validateBlockAnnotations, applyCoercions } from './block-annotation-validator'
import { ensureBlockMedia } from './ensure-block-media'
import { truncateToTokenBudget, checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { countWords, targetWordCount } from './word-count-validator'
import { buildBrandVoiceBlock, buildFirmContext } from './brand-voice'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { Json } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'

type Cta = { text: string; url: string }
const DEFAULT_CTA: Cta = { text: 'Schedule a consultation', url: '/contact' }
const CONTENT_MODEL = 'claude-sonnet-4-6'

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
    hero_block: string
    hero_variant: string | null
    hero_image: string | null
    hero_image_alt: string | null
    hero_subhead: string | null
    hero_image_query: string | null
  }
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
  contentJobId: string,
  sessionId: string,
  sitemapUrls: string[],
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

${buildBrandVoiceBlock(schema)}

${buildFirmContext(schema)}

PALETTE TONE: ${paletteTone}

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
   - internal_links (array of {url, anchor_text, reason}. ONLY use URLs from this exact list — never invent paths: ${sitemapUrls.join(' ')}. The same rule applies to every relative link you write in the body copy.)
   - faq_block (array of {question, answer} — 40-60 words per answer)
   - llm_citation_note (what structured claim an AI tool would most likely cite)
   - hero_block (one of: "hero", "hero-split", "page-header")
   - hero_variant (string or null — required for "hero" and "hero-split"; null for "page-header")
   - hero_image (kebab-case .jpg filename — ALWAYS provide one whenever hero_block is not "page-header"; null only for page-header)
   - hero_image_alt (8-15 word literal description of what the hero photo shows — for screen readers and image SEO, not marketing copy. Example: "Accountant reviewing financial documents with a small business owner". ALWAYS provide one whenever hero_image is set; null otherwise.)
   - hero_subhead (12-18 words, benefit-led, written for the on-page hero — NOT the same as meta_description, which targets SERPs. Speak directly to the reader's outcome; avoid restating the firm name or the page title. Plain prose, no quotes, no trailing period required.)
   - hero_image_query (3-8 word SUBJECT-only Pexels search query that captures the visual concept for this page's hero photo. Focus on the SUBJECT MATTER — people, setting, activity — not visual style. Examples: "tax season paperwork accountant", "client meeting professional office", "small business owner reviewing financials", "construction contractor on site". The builder appends brand-specific style modifiers automatically (cool tone, modern office, etc.) — you don't need to include those. ALWAYS provide a non-null query whenever hero_block is not "page-header"; null only for page-header heroes.)

BLOCK ANNOTATION RULES:

Before every ## section heading in the content body, emit an HTML comment on the immediately preceding line:
<!-- block: {block-id} | variant: {variant} -->

Images are MANDATORY for these blocks — always extend the annotation with image + alt + query attributes so the builder can fetch from Pexels:
- content-split: every instance
- checklist-section: every instance (use variant with-image)
- cta-banner: only when variant is image-bg (never put image on color-bg)
<!-- block: content-split | variant: image-right | image: services-overview.jpg | alt: "Accountants in a planning meeting around a conference table" | query: "professional team meeting modern office" -->

The "image:" attribute is a short kebab-case filename ending in .jpg (don't include path prefixes). The "alt:" attribute is an 8-15 word literal description of what the photo shows — written for screen readers and image SEO, not marketing copy. The "query:" attribute is a 3-8 word SUBJECT-only Pexels search string — focus on people, setting, activity. Skip visual style modifiers ("cinematic", "warm tones", etc.) — the builder appends those automatically per brand. Attribute order is fixed: image, then alt, then query.

Choose the block that best fits the section. Catalog:

intro-text          → Short headline + paragraph transition
content-split       → Narrative paragraph with a supporting image
content-prose       → Long-form copy, no supporting image
checklist-section   → List of benefits, inclusions, or qualifying criteria
process-steps       → Numbered or sequential how-it-works steps
feature-grid        → 3–8 equal features with icon + short description
service-cards       → 2–9 named services with descriptions and links
content-cards       → Articles or resources with images
team-grid           → Staff or partner profiles with photos
industry-cards      → Industry or niche verticals with icons
testimonials        → Client quotes or reviews
stats-bar           → 3–4 numeric proof points
logo-bar            → Certification badges or association logos
cta-banner          → A direct call to action with a button
pricing             → Tiered service packages with prices and feature lists
form                → A contact, quote, or newsletter form
content-table       → Comparison data or structured reference info

DO NOT use these inline (they are page-level only):
  hero, hero-split, page-header

DO NOT annotate with faq-accordion — it is auto-appended by the deliverable builder.

DO NOT annotate with contact-info or map on /contact (or any "/contact" path). The deliverable builder auto-injects those blocks using firm phone/email/hours/address from brand.json. If you generate a contact page, focus on a short intro-text and any narrative content — never inline phone numbers, email addresses, or street addresses in body prose. Those values come from session data, not Claude. Hallucinating placeholder numbers like "(555) 555-0100" or "info@example.com" on contact pages has been a recurring bug; the builder strips such patterns automatically as a safety net, but don't emit them in the first place.

DO NOT include an FAQ section in the body content under ANY annotation (content-prose, intro-text, or otherwise). The deliverable builder auto-appends a structured FAQ accordion from the faq_block metadata you return. Emitting a body section like "## Frequently Asked Questions" or "## FAQ" causes the assembled page to render the same Q&A twice. Put all FAQ content in the metadata.faq_block array — the body must not contain any heading that starts with "Frequently Asked Questions" or "FAQ".

ITEM-LEVEL FORMAT — for any block that contains a list of items (service-cards, industry-cards, feature-grid, team-grid, pricing, content-cards, process-steps), introduce EACH item with a \`### Title\` H3 heading on its own line, with the item body on subsequent lines.

✓ Correct:
  ### Healthcare Professionals
  Practice owners face billing complexity, staffing costs, and...

  ### Contractors and Trades
  Job costing, equipment financing, bonding requirements...

✗ Wrong (treated as inline prose, not as cards):
  **Healthcare Professionals**
  Practice owners face billing complexity...

  **Contractors and Trades**
  Job costing, equipment financing...

Per-block item formats:
- service-cards / industry-cards / feature-grid: \`### Item Title\`, then an \`icon:\` line choosing the card's icon (EVERY item MUST have one), then a 1–4 sentence description:

      ### Healthcare Professionals
      icon: Stethoscope

      Practice owners face billing complexity, staffing costs, and...

  Pick the most specific fitting icon per item from this set (PascalCase, exact): Calculator, Briefcase, ChartLine, ChartBar, TrendingUp, FileText, FileCheck, ClipboardCheck, Coins, DollarSign, CreditCard, Wallet, PiggyBank, Receipt, Users, UserCheck, Building, Building2, Home, MapPin, Globe, ShieldCheck, Award, Star, BadgeCheck, Hammer, Wrench, Cog, HeartPulse, Stethoscope, GraduationCap, Scale, Gavel, Lightbulb, Target, Zap, Sparkles, Calendar, Clock. Never repeat an icon within one block.
- content-cards: \`### Card Title\` then \`photo:\` and \`query:\` lines, then a 1–3 sentence excerpt, then an optional trailing \`[Read more](/url)\` link. The photo lines look like:

      ### Year-End Tax Planning Guide
      photo: year-end-planning.jpg
      query: tax planner reviewing year end documents

      Excerpt prose here...

  Include photo + query on EVERY content-card without exception — these are article thumbnails and always need an image. Same kebab-case filename and SUBJECT-only query conventions as content-split.
- team-grid: \`### Name, Credentials\` then an optional short job title line, then bio paragraph(s).
- pricing: \`### Tier Name\` then \`$price/period\` on the next line, then a 1–2 sentence description, then a feature list (\`- Feature 1\`), then a \`[Get started](/contact)\` CTA. Mark a featured tier with \`**Most popular**\` inside its description.
- process-steps: \`### Step Title\` (the parser auto-numbers them) then a 1–2 sentence description.

For feature-grid and industry-cards, the icon-bullet alternative (\`- IconName: **Title** — Description\`) is also accepted but is NOT preferred — use the \`### Title\` form unless the block design specifically calls for icons.

The \`**bold paragraph**\` form is for inline emphasis only, never as a structural item heading.

VARIANT RULES — every variant value must come from the block's catalog above. NEVER emit \`variant: default\` (it is not a real variant for any block); pick a specific value from the catalog or omit the \`variant:\` key entirely.
- content-split: alternate image-right and image-left across consecutive sections
- feature-grid: 3-col by default; 4-col only if 8+ items
- service-cards: 3-col by default; 2-col if descriptions exceed 4 sentences
- team-grid: 2-col ≤4 people, 3-col 5–9, 4-col 10+
- cta-banner: MIX variants across the site — prefer image-bg for a page's final/primary banner (MUST carry image: + query:); color-bg for secondary mid-page CTAs (no image)
- form: contact variant unless quote or newsletter clearly fits
- pricing: match tier count to packages described (2-tier / 3-tier / 4-tier)
- intro-text: centered by default; left-aligned only when feeding into left-aligned content
- checklist-section: with-image by default (carries the mandatory image: + query:); standalone only for a short inline qualifying list with no room for a supporting photo
- process-steps: vertical by default; horizontal only for short 3–5-step flows
- testimonials: grid by default; carousel only when 4+ testimonials
- stats-bar: 3-up by default; 4-up if you have exactly 4 numbers
- industry-cards: 3-col by default; 4-col only if 8+ industries
- content-cards: 3-col by default; 2-col for longer excerpts

HERO BLOCK (page-level — return in metadata, NOT inline):
Choose ONE hero block for the page opener:
- "hero" with variant "image"|"video"|"slider" — full-bleed dominant opener (homepage and key landing pages)
- "hero-split" with variant "image-right"|"image-left" — opener with side-by-side text + image (About pages, primary service pages)
- "page-header" with NO variant — slim inner-page title bar (most inner pages)

Default to "page-header" if uncertain. Use "hero" only on the homepage and high-value landing pages.

${ANTI_SLOP_RULES}${retryNote}`

  const { text, usage } = await generateText({
    model: anthropic(CONTENT_MODEL),
    prompt,
    maxOutputTokens: 4000,
  })

  console.warn(
    `[content-gen] page="${pageUrl}" input=${usage?.inputTokens ?? '?'} output=${usage?.outputTokens ?? '?'}`
  )
  checkTokenBudget('content', pageUrl, usage?.inputTokens, 5000)
  await recordTokenUsage({
    task: 'content',
    contentJobId,
    sessionId,
    stage: 'content',
    pageUrl,
    model: CONTENT_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

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
        hero_block: parsed.metadata?.hero_block ?? 'page-header',
        hero_variant: parsed.metadata?.hero_variant ?? null,
        hero_image: parsed.metadata?.hero_image ?? null,
        hero_image_alt: typeof parsed.metadata?.hero_image_alt === 'string' && parsed.metadata.hero_image_alt.trim()
          ? parsed.metadata.hero_image_alt.trim()
          : null,
        hero_subhead: typeof parsed.metadata?.hero_subhead === 'string' && parsed.metadata.hero_subhead.trim()
          ? parsed.metadata.hero_subhead.trim()
          : null,
        hero_image_query: typeof parsed.metadata?.hero_image_query === 'string' && parsed.metadata.hero_image_query.trim()
          ? parsed.metadata.hero_image_query.trim()
          : null,
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
        hero_block: 'page-header',
        hero_variant: null,
        hero_image: null,
        hero_image_alt: null,
        hero_subhead: null,
        hero_image_query: null,
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
): Promise<{ status: 'complete' | 'error' | 'skipped'; pageUrl: string; error?: string }> {
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
    .select('session_id, palette, confirmed_sitemap')
    .eq('id', contentJobId)
    .single()
  if (!job) return { status: 'error', pageUrl: outline.page_url, error: 'Content job not found' }

  // Real page URLs for the internal_links constraint — without this list the
  // model invents plausible-but-wrong paths (/team, /services/bookkeeping).
  const sitemapUrls = ((job.confirmed_sitemap as Array<{ url?: string }>) ?? [])
    .map((s) => s.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

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

  // Atomic lock: refuse if the row is already 'running'. Two callers
  // racing for the same page (e.g., bulk run + manual regenerate) would
  // otherwise overwrite each other. Any non-running prior state can be
  // claimed for (re-)generation.
  const { data: locked } = await supabase
    .from('generated_pages')
    .update({ generation_status: 'running' })
    .eq('id', genPage.id)
    .neq('generation_status', 'running')
    .select('id')
  if (!locked?.length) {
    return { status: 'skipped', pageUrl: outline.page_url, error: 'Another worker is already generating this page' }
  }

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
      cta,
      contentJobId,
      job.session_id,
      sitemapUrls
    )

    const validation = validateContent(result.content)
    if (!validation.passed) {
      console.warn(
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
        contentJobId,
        job.session_id,
        sitemapUrls,
        validation.flagged
      )
    }

    const annotations = parseBlockAnnotations(result.content)
    const headingCount = (result.content.match(/^##\s+/gm) || []).length
    const blockValidation = validateBlockAnnotations(annotations, outline.page_url, result.metadata.faq_block)

    // Missing-annotation check: if the body has ## sections but few or no
    // annotations, Claude ignored the block-annotation rules. Force a retry
    // with explicit feedback. We tolerate up to (headingCount - 1) missing
    // annotations as warning-only (e.g. final CTA section); zero annotations
    // when sections exist is always a fatal regeneration trigger.
    const missingAnnotations = headingCount > 0 && annotations.length === 0

    if (missingAnnotations) {
      console.warn(
        `[content-gen] Missing block annotations on ${outline.page_url} (${headingCount} ## sections, 0 annotations) — forcing retry`
      )
      const correctionNote =
        `Your previous draft had ${headingCount} "##" sections but ZERO block annotations. ` +
        `Every "##" section heading MUST be preceded on the line above by an HTML comment like ` +
        `\`<!-- block: feature-grid | variant: 3-col -->\`. Re-emit the entire page with a block ` +
        `annotation on every "##" heading, using the catalog from the system prompt. ` +
        `Do NOT use hero, hero-split, page-header, or faq-accordion inline.`
      result = await generatePageContent(
        outline.page_title, outline.page_url, outline.sections,
        targetKeyword, secondaryKeywords, existingContent, competitorRefs,
        schema, palette, session.website_url, cta,
        contentJobId, job.session_id,
        sitemapUrls,
        [correctionNote]
      )
      // Re-parse after retry; if still empty, log and store anyway.
      const retryAnnotations = parseBlockAnnotations(result.content)
      if (retryAnnotations.length === 0) {
        console.warn(
          `[content-gen] Annotations still missing after retry on ${outline.page_url}; storing anyway (admin must manually annotate)`
        )
      }
    } else if (!blockValidation.passed && blockValidation.errors.length > 0) {
      console.warn(
        `[content-gen] Block validation errors on ${outline.page_url}:`,
        blockValidation.errors.map(e => `[section ${e.position}] ${e.reason}`).join(' | ')
      )

      // Single retry: full-page regeneration with all errors listed.
      // (The spec proposes per-section correction; we use full-page retry for
      // simplicity. If the LLM can't fix issues in one retry, the errors are
      // logged and content is stored as-is — admin can manually correct.)
      const errorSummary = blockValidation.errors
        .map(e =>
          e.fix === 'add-image'
            ? `Section ${e.position} ("${e.headingText}"): ${e.reason}. Keep the block — add image: + query: attributes to its annotation comment.`
            : `Section ${e.position} ("${e.headingText}"): ${e.reason}. Suggested replacement: ${e.suggestion ?? 'content-prose'}`
        )
        .join('\n')
      const correctionNote = `Your previous draft had these block annotation issues — fix all of them:\n${errorSummary}`

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
        contentJobId,
        job.session_id,
        sitemapUrls,
        [correctionNote]  // reuse the flaggedPhrases mechanism to carry the correction note
      )

      const retryAnnotations = parseBlockAnnotations(result.content)
      const retryValidation = validateBlockAnnotations(retryAnnotations, outline.page_url, result.metadata.faq_block)
      if (!retryValidation.passed) {
        console.warn(
          `[content-gen] Block validation still failing after retry on ${outline.page_url}; storing anyway:`,
          retryValidation.errors.map(e => e.reason).join(' | ')
        )
      }
    }

    // Apply variant coercions (invalid variant values like `default` get
    // auto-fixed to the block's first valid variant). Done after any retry
    // so we coerce on the latest result.content.
    const finalAnnotations = parseBlockAnnotations(result.content)
    const finalValidation = validateBlockAnnotations(
      finalAnnotations,
      outline.page_url,
      result.metadata.faq_block
    )
    if (finalValidation.coercions.length > 0) {
      console.warn(
        `[content-gen] Coerced ${finalValidation.coercions.length} variant(s) on ${outline.page_url}:`,
        finalValidation.coercions.map(c => `${c.blockId}: '${c.originalVariant}' → '${c.coercedVariant}'`).join(' | ')
      )
      result.content = applyCoercions(result.content, finalValidation.coercions)
    }

    if (finalValidation.warnings.length > 0) {
      console.warn(
        `[content-gen] Block warnings on ${outline.page_url}:`,
        finalValidation.warnings.join(' | ')
      )
    }

    // Guaranteed image coverage: if the retry still left a structural image
    // slot empty, inject a deterministic filename + heading-derived Pexels
    // query so the package-time resolver always has something to fetch.
    const ensured = ensureBlockMedia(
      result.content,
      outline.page_url,
      result.metadata.target_keyword ?? ''
    )
    if (ensured !== result.content) {
      console.warn(`[content-gen] Injected placeholder image refs on ${outline.page_url}`)
      result.content = ensured
    }

    // Deterministic dash humanizer: strip em-dashes (and word en-dashes) the model
    // leaves behind, on the body and the visible text metadata. Numeric ranges,
    // code fences, and block annotations are preserved.
    result.content = humanizeDashes(result.content)
    result.metadata.meta_description = humanizeDashes(result.metadata.meta_description)
    result.metadata.answer_block = humanizeDashes(result.metadata.answer_block)
    result.metadata.faq_block = result.metadata.faq_block.map(f => ({
      ...f,
      answer: humanizeDashes(f.answer),
    }))

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
        secondary_keywords: asJson(result.metadata.secondary_keywords),
        url_slug: result.metadata.url_slug,
        canonical_url: result.metadata.canonical_url,
        answer_block: result.metadata.answer_block,
        schema_markup_type: result.metadata.schema_markup_type,
        eeat_signals: asJson(result.metadata.eeat_signals),
        internal_links: asJson(result.metadata.internal_links),
        faq_block: asJson(result.metadata.faq_block),
        llm_citation_note: result.metadata.llm_citation_note,
        hero_block: result.metadata.hero_block,
        hero_variant: result.metadata.hero_variant,
        hero_image: result.metadata.hero_image,
        hero_image_alt: result.metadata.hero_image_alt,
        hero_subhead: result.metadata.hero_subhead,
        hero_image_query: result.metadata.hero_image_query,
        word_count_actual: wcActual,
        word_count_target: wcTarget || null,
        admin_approved_content: false,  // re-review required after every generation
        generation_status: 'complete',
      })
      .eq('id', genPage.id)

    console.warn(`[content-gen] Complete: ${outline.page_title} (${wcActual} words / target ${wcTarget})`)
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

  // Process in small parallel batches. Sequential generation took ~12s per
  // page, which put 26-page jobs right at the 300s maxDuration cap and got
  // them killed mid-run. Batch size 3 mirrors the research pipeline and stays
  // well within Anthropic's RPM/TPM limits for Sonnet while bringing total
  // wall time to ~100s for a 26-page job — one click finishes the lot.
  const BATCH_SIZE = 3
  // Soft deadline well under the 300s route maxDuration. When a batch would
  // push elapsed time past this, we stop processing and chain to a fresh
  // function invocation via HTTP self-call. 240s leaves ~60s for the final
  // completion check, phase advance, email, and the self-fetch call.
  const SOFT_DEADLINE_MS = 240_000
  const startedAt = Date.now()
  let completedThisRun = 0

  for (let i = 0; i < outlines.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      console.warn(
        `[content-gen] Soft deadline reached after ${i} pages, chaining continuation.`
      )
      break
    }
    const batch = outlines.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (outline) => {
      // Skip pages already complete to make this loop idempotent on re-run.
      const { data: genPage } = await supabase
        .from('generated_pages')
        .select('generation_status')
        .eq('content_job_id', contentJobId)
        .eq('page_url', outline.page_url)
        .single()
      if (genPage?.generation_status === 'complete') return

      await generateSinglePage(contentJobId, outline.id)
      completedThisRun += 1
    }))
  }

  // Check completion + advance phase + email notification.
  const { data: allPages } = await supabase
    .from('generated_pages')
    .select('generation_status')
    .eq('content_job_id', contentJobId)

  const allDone = allPages?.every(p => p.generation_status === 'complete' || p.generation_status === 'error')
  const completeCount = allPages?.filter(p => p.generation_status === 'complete').length ?? 0
  const errorCount = allPages?.filter(p => p.generation_status === 'error').length ?? 0

  // Auto-chain when more work remains and this invocation made progress. The
  // `completedThisRun > 0` guard prevents an infinite cascade if a job is
  // permanently stuck (e.g., every page errors instantly). Without it, an all-
  // failing job would self-fetch forever.
  if (!allDone && completedThisRun > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    const cronSecret = process.env.CRON_SECRET
    if (!baseUrl || !cronSecret) {
      console.warn(
        '[content-gen] Auto-chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.'
      )
      return
    }
    const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`

    // Mid-progress email at each continuation boundary. A full site can take
    // several chained invocations; this reassures the admin that work is still
    // moving rather than leaving them watching a silent dashboard.
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const total = allPages?.length ?? 0
        const { data: progressSession } = await supabase
          .from('sessions')
          .select('schema_data')
          .eq('id', sessionId)
          .single()
        const firmName = ((progressSession?.schema_data ?? {}) as SessionSchema).business?.name ?? 'Unknown firm'
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: process.env.ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL,
          subject: `[Revaltus] Content generation in progress — ${firmName}`,
          html: `
            <h2>Content Generation In Progress</h2>
            <p><strong>${firmName}</strong></p>
            <p>${completeCount} of ${total} pages complete${errorCount > 0 ? `, ${errorCount} errors` : ''}. Generation is continuing automatically — no action needed.</p>
            <p><a href="${appUrl}/admin/content/${sessionId}">View progress →</a></p>
          `,
        })
      } catch (emailErr) {
        console.warn('[content-gen] Progress email failed:', emailErr)
      }
    }

    try {
      const res = await fetch(`${url}/api/content-jobs/${contentJobId}/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      console.warn(
        `[content-gen] Chained continuation: completed=${completedThisRun} this run, status=${res.status}`
      )
    } catch (err) {
      console.error('[content-gen] Auto-chain self-call failed:', err)
    }
    return
  }

  if (allDone) {
    await supabase
      .from('content_jobs')
      .update({ phase: 6, updated_at: new Date().toISOString() })
      .eq('id', contentJobId)

    console.warn(`[content-job] phase 5→6 session=${sessionId} complete=${completeCount} errors=${errorCount}`)

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
          subject: `[Revaltus] Content ready for review — ${firmName}`,
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
