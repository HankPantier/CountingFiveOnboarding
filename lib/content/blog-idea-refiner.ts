import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import type { ExternalLink } from './link-checker'

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
  // Candidate authoritative sources. UNVERIFIED here — the create route
  // HEAD-checks these before they reach any per-client drafting prompt.
  suggested_external_links: ExternalLink[]
}

// Mirrors the source-suggestion guardrails from resource-idea-generator so
// batch posts can cite authoritative URLs, validated downstream.
const EXTERNAL_SOURCES_GUIDANCE = `EXTERNAL SOURCES: suggest 1-3 authoritative URLs that would validate the post's claims. ONLY use domains you are confident exist: irs.gov, sba.gov, state department-of-revenue sites, aicpa-cima.com, bls.gov, federalreserve.gov, established financial publications. Use real, stable URLs (section landing pages over deep links). If none clearly fit, return an empty array.`

export type RefineBlogIdeaInput = {
  seed: string
  // Prior refined idea + a follow-up instruction drive the iterative loop.
  current?: RefinedBlogIdea | null
  instruction?: string
}

function buildPrompt(input: RefineBlogIdeaInput): string {
  const revising = input.current && input.instruction?.trim()

  if (revising) {
    const c = input.current as RefinedBlogIdea
    return `You are a content strategist for CPA / accounting firms. Refine an existing blog-post idea per the editor's instruction.

CURRENT IDEA:
Title: ${c.title}
Angle: ${c.angle}
Primary keyword: ${c.target_keyword}
Secondary keywords: ${c.secondary_keywords.join(', ')}
Rationale: ${c.rationale}

ORIGINAL SEED: ${input.seed}

EDITOR INSTRUCTION (apply this): ${input.instruction}

Keep the idea generic enough to work for multiple different CPA firms (it will be tailored to each firm's brand and location later) — do NOT bake in a specific firm name, city, or niche unless the instruction asks for it.

${EXTERNAL_SOURCES_GUIDANCE}

Return ONLY a JSON object:
{ "title": "...", "angle": "one-line hook", "target_keyword": "...", "secondary_keywords": ["...", "..."], "rationale": "why this topic earns attention and ranks", "suggested_external_links": [{"url": "...", "title": "..."}] }`
  }

  return `You are a content strategist for CPA / accounting firms. Sharpen the editor's rough topic into one fully-formed blog-post idea.

EDITOR'S TOPIC: ${input.seed}

Produce a single strong idea: a specific, opinionated title (not a generic listicle), a one-line angle, a primary SEO keyword, 2-4 secondary keywords, and a short rationale. Keep it generic enough to work for multiple different CPA firms — it will be tailored to each firm's brand and location later — so do NOT bake in a specific firm name, city, or niche.

${EXTERNAL_SOURCES_GUIDANCE}

Return ONLY a JSON object:
{ "title": "...", "angle": "one-line hook", "target_keyword": "...", "secondary_keywords": ["...", "..."], "rationale": "why this topic earns attention and ranks", "suggested_external_links": [{"url": "...", "title": "..."}] }`
}

export async function refineBlogIdea(input: RefineBlogIdeaInput): Promise<RefinedBlogIdea | null> {
  const { text, usage } = await generateText({
    model: anthropic(REFINE_MODEL),
    system: 'You are an SEO and content strategist for CPA firms. Return JSON only, no prose.',
    prompt: buildPrompt(input),
    maxOutputTokens: 1000,
  })

  checkTokenBudget('blog-idea-refine', input.seed.slice(0, 40), usage?.inputTokens, 5000)
  await recordTokenUsage({
    task: 'content',
    stage: 'idea',
    model: REFINE_MODEL,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })

  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!parsed?.title || typeof parsed.title !== 'string') return null
    return {
      title: parsed.title.trim(),
      angle: typeof parsed.angle === 'string' ? parsed.angle.trim() : '',
      target_keyword: typeof parsed.target_keyword === 'string' ? parsed.target_keyword.trim() : '',
      secondary_keywords: Array.isArray(parsed.secondary_keywords)
        ? parsed.secondary_keywords.filter((k: unknown): k is string => typeof k === 'string')
        : [],
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
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
  } catch {
    console.error('[blog-idea-refine] Failed to parse Claude response')
    return null
  }
}
