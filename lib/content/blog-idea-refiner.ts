import { anthropic } from '@ai-sdk/anthropic'
import { checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { generateJson } from './json-generation'
import { CONTENT_TYPES, asContentType, type ContentType } from './content-types'
import { asIndustry, INDUSTRY_OPTIONS, type Industry } from './industries'
import type { ExternalLink } from './link-checker'

// Per-type framing for the brand-agnostic refinement prompt. The idea stays
// generic across firms; the type only shapes what kind of piece it becomes.
const TYPE_REFINE_GUIDANCE: Record<ContentType, string> = {
  blog: '',
  article:
    'This will become a longer, in-depth researched article — pick a topic with enough substance to sustain 1,800+ words.',
  'thought-leadership':
    'This will become a thought-leadership piece — the idea should carry a clear, opinionated stance, not a neutral explainer.',
  'case-study':
    'This will become a case study — frame it as a client-outcome narrative (situation → what was done → measurable result). Each firm grounds it in its own real client story downstream.',
}

// Brand-agnostic blog-idea refinement for the blog-first multi-client tool.
// The admin authors a rough topic; this sharpens it into a reusable idea that
// is later fanned out to many clients. There is NO client/MBP context here on
// purpose — per-client voice is applied downstream by generateResourceDraft,
// once specific clients are selected.
const REFINE_MODEL = 'claude-sonnet-5'

export type RefinedBlogIdea = {
  title: string
  angle: string
  target_keyword: string
  secondary_keywords: string[]
  rationale: string
  // The vertical this idea best fits. INFERRED here for the operator to confirm
  // at batch creation — it is not baked into the drafting prompt (the idea stays
  // brand-agnostic); it only tags the content for later library filtering.
  industry: Industry
  // Candidate authoritative sources. UNVERIFIED here — the create route
  // HEAD-checks these before they reach any per-client drafting prompt.
  suggested_external_links: ExternalLink[]
}

// Mirrors the source-suggestion guardrails from resource-idea-generator so
// batch posts can cite authoritative URLs, validated downstream.
const EXTERNAL_SOURCES_GUIDANCE = `EXTERNAL SOURCES: suggest 1-3 authoritative URLs that would validate the post's claims. ONLY use domains you are confident exist: irs.gov, sba.gov, state department-of-revenue sites, aicpa-cima.com, bls.gov, federalreserve.gov, established financial publications. Use real, stable URLs (section landing pages over deep links). If none clearly fit, return an empty array.`

// Ask the model to tag the idea's vertical so the operator can confirm it at
// batch creation. The list is the controlled Industry union (industries.ts).
const INDUSTRY_GUIDANCE = `INDUSTRY: classify this idea into the single best-fit vertical from these slugs: ${INDUSTRY_OPTIONS.map((o) => o.value).join(', ')}. If unsure, use "tax-accounting".`

export type RefineBlogIdeaInput = {
  seed: string
  // Prior refined idea + a follow-up instruction drive the iterative loop.
  current?: RefinedBlogIdea | null
  instruction?: string
  contentType?: ContentType
  // No client is selected yet at refine time, so there's nothing session-scoped
  // to attribute against — carry the acting user so the spend isn't Unattributed.
  createdBy?: string | null
}

function buildPrompt(input: RefineBlogIdeaInput): string {
  const revising = input.current && input.instruction?.trim()
  const contentType = asContentType(input.contentType)
  const noun = CONTENT_TYPES[contentType].articleNoun
  const typeGuidance = TYPE_REFINE_GUIDANCE[contentType]
  const typeLine = typeGuidance ? `\n\n${typeGuidance}` : ''

  if (revising) {
    const c = input.current as RefinedBlogIdea
    return `You are a content strategist for CPA / accounting firms. Refine an existing ${noun} idea per the editor's instruction.

CURRENT IDEA:
Title: ${c.title}
Angle: ${c.angle}
Primary keyword: ${c.target_keyword}
Secondary keywords: ${c.secondary_keywords.join(', ')}
Rationale: ${c.rationale}

ORIGINAL SEED: ${input.seed}

EDITOR INSTRUCTION (apply this): ${input.instruction}

Keep the idea generic enough to work for multiple different CPA firms (it will be tailored to each firm's brand and location later) — do NOT bake in a specific firm name, city, or niche unless the instruction asks for it.${typeLine}

${EXTERNAL_SOURCES_GUIDANCE}

${INDUSTRY_GUIDANCE}

Return ONLY a JSON object:
{ "title": "...", "angle": "one-line hook", "target_keyword": "...", "secondary_keywords": ["...", "..."], "rationale": "why this topic earns attention and ranks", "industry": "one of the industry slugs above", "suggested_external_links": [{"url": "...", "title": "..."}] }`
  }

  return `You are a content strategist for CPA / accounting firms. Sharpen the editor's rough topic into one fully-formed ${noun} idea.

EDITOR'S TOPIC: ${input.seed}

Produce a single strong idea: a specific, opinionated title (not a generic listicle), a one-line angle, a primary SEO keyword, 2-4 secondary keywords, and a short rationale. Keep it generic enough to work for multiple different CPA firms — it will be tailored to each firm's brand and location later — so do NOT bake in a specific firm name, city, or niche.${typeLine}

${EXTERNAL_SOURCES_GUIDANCE}

${INDUSTRY_GUIDANCE}

Return ONLY a JSON object:
{ "title": "...", "angle": "one-line hook", "target_keyword": "...", "secondary_keywords": ["...", "..."], "rationale": "why this topic earns attention and ranks", "industry": "one of the industry slugs above", "suggested_external_links": [{"url": "...", "title": "..."}] }`
}

export async function refineBlogIdea(input: RefineBlogIdeaInput): Promise<RefinedBlogIdea | null> {
  const prompt = buildPrompt(input)

  // Shared robust JSON generation: one call + tolerant parse + a single
  // larger-budget retry on a truncated `length` finish, all with SDK backoff.
  // This is an interactive button click, so — unlike the async page/resource
  // generators — we deliberately skip high-effort adaptive thinking (no
  // providerOptions) to stay snappy.
  const parsed = (await generateJson({
    model: anthropic(REFINE_MODEL),
    system: 'You are an SEO and content strategist for CPA firms. Return JSON only, no prose.',
    prompt,
    firstBudget: 2000,
    retryBudget: 4000,
    label: 'blog-idea-refine',
    onAttempt: (usage) => {
      checkTokenBudget('blog-idea-refine', input.seed.slice(0, 40), usage?.inputTokens, 5000)
      return recordTokenUsage({
        task: 'content',
        stage: 'idea',
        createdBy: input.createdBy ?? null,
        model: REFINE_MODEL,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      })
    },
  })) as ({ title?: unknown } & Record<string, unknown>) | null

  if (!parsed?.title || typeof parsed.title !== 'string') return null

  return {
    title: parsed.title.trim(),
    angle: typeof parsed.angle === 'string' ? parsed.angle.trim() : '',
    target_keyword: typeof parsed.target_keyword === 'string' ? parsed.target_keyword.trim() : '',
    secondary_keywords: Array.isArray(parsed.secondary_keywords)
      ? parsed.secondary_keywords.filter((k: unknown): k is string => typeof k === 'string')
      : [],
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    industry: asIndustry(parsed.industry),
    suggested_external_links: Array.isArray(parsed.suggested_external_links)
      ? parsed.suggested_external_links
          .filter(
            (l: unknown): l is { url: string; title?: unknown } =>
              !!l && typeof (l as { url?: unknown }).url === 'string'
          )
          .map((l: { url: string; title?: unknown }) => ({
            url: l.url,
            title: typeof l.title === 'string' ? l.title : undefined,
          }))
      : [],
  }
}
