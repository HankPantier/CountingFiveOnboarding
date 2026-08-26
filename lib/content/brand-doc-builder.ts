import { anthropic } from '@ai-sdk/anthropic'
import { GENERATION_PROVIDER_OPTIONS, OUTLINE_PROVIDER_OPTIONS, PUBLISHED_CONTENT_MODEL } from './generation-tuning'
import { checkTokenBudget } from './truncate-to-token-budget'
import { recordTokenUsage } from './token-usage'
import { generateJson } from './json-generation'
import type { SessionSchema } from '@/types/session-schema'

export type BrandDoc = {
  summary: string  // 1–2 paragraph blockquote-friendly description (~600 chars)
  fullDoc: string  // full brand brief markdown (~600–1000 words)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function joinList(items: unknown): string {
  if (!Array.isArray(items)) return ''
  return items.filter(nonEmpty).join(', ')
}

export function compileBrandDoc(schema: SessionSchema): BrandDoc {
  const business = schema.business ?? ({} as NonNullable<SessionSchema['business']>)
  const niches = schema.niches ?? []
  const firstLocation = schema.locations?.[0]
  const firmName = nonEmpty(business.name) ? business.name : 'The firm'

  // ---- Identity ----
  const identityParts: string[] = []
  const headline: string[] = [firmName]
  if (nonEmpty(business.foundingYear)) headline.push(`founded ${business.foundingYear}`)
  if (firstLocation && nonEmpty(firstLocation.city)) {
    const loc = nonEmpty(firstLocation.state)
      ? `${firstLocation.city}, ${firstLocation.state}`
      : firstLocation.city
    headline.push(loc)
  }
  identityParts.push(headline.join(' · '))
  if (nonEmpty(business.tagline)) identityParts.push(`Tagline: ${business.tagline}`)
  if (nonEmpty(business.geographicScope)) identityParts.push(`Geographic scope: ${business.geographicScope}`)

  // ---- Positioning ----
  const positioningParts: string[] = []
  if (nonEmpty(business.positioningStatement)) positioningParts.push(business.positioningStatement)
  if (nonEmpty(business.differentiators)) positioningParts.push(`**Differentiators:** ${business.differentiators}`)
  const idealClients = joinList(business.idealClients)
  if (idealClients) positioningParts.push(`**Ideal clients:** ${idealClients}`)

  // ---- Niches ----
  const nicheBlocks: string[] = []
  for (const n of niches) {
    if (!nonEmpty(n?.name)) continue
    const block: string[] = [`### ${n.name}`]
    if (nonEmpty(n.painPoints)) block.push(`Pain points: ${n.painPoints}`)
    if (nonEmpty(n.valueProp)) block.push(`Value: ${n.valueProp}`)
    if (block.length > 1) nicheBlocks.push(block.join('\n'))
  }

  // ---- Assemble fullDoc ----
  const sections: string[] = [`# About ${firmName}`]
  if (identityParts.length) sections.push(`## Identity\n${identityParts.join('\n')}`)
  if (positioningParts.length) sections.push(`## Positioning & Differentiation\n${positioningParts.join('\n\n')}`)
  if (nicheBlocks.length) sections.push(`## Industries Served\n${nicheBlocks.join('\n\n')}`)
  const fullDoc = sections.join('\n\n')

  // ---- Summary (deterministic) ----
  const summaryParts: string[] = []
  const opener = nonEmpty(business.tagline)
    ? `${firmName} — ${business.tagline}.`
    : `${firmName}.`
  summaryParts.push(opener)
  if (nonEmpty(business.positioningStatement)) summaryParts.push(business.positioningStatement)
  const nicheNames = niches.map(n => n?.name).filter(nonEmpty)
  if (nicheNames.length) summaryParts.push(`Serves ${nicheNames.join(', ')}.`)
  const summary = summaryParts.join(' ')

  return { summary, fullDoc }
}

export async function generateBrandDoc(
  schema: SessionSchema,
  ctx?: { sessionId?: string | null; contentJobId?: string | null }
): Promise<BrandDoc> {
  const fallback = compileBrandDoc(schema)
  const firmName = schema.business?.name ?? 'the firm'

  // Strip _meta and large content arrays before sending to Claude.
  const { _meta, proposed_sitemap, current_sitemap, content_gaps, ...trimmed } =
    schema as SessionSchema & { _meta?: unknown; content_gaps?: unknown }
  void _meta; void proposed_sitemap; void current_sitemap; void content_gaps

  const prompt = `You are writing a brand brief that LLM crawlers will ingest to understand this CPA firm. Use the firm's own positioning and audience — do not invent details.

FIRM SCHEMA (JSON):
${JSON.stringify(trimmed, null, 2)}

Return JSON only — no prose, no code fences:
{
  "summary": "1–2 short paragraphs, ~400–600 characters. Reads as a blockquote: who they are, who they serve, what's distinctive. No headings.",
  "fullDoc": "Full markdown brand brief, 600–1000 words, with these H2 sections in order: ## Identity, ## Positioning & Differentiation, ## Industries Served (one H3 per niche). Skip a section entirely if its source fields are empty. Start with '# About <Firm Name>'."
}

RULES:
- For each niche, include pain points and value proposition if present.
- No marketing fluff or invented credentials.`

  // Generous budget: adaptive thinking shares maxOutputTokens, and a tight cap
  // starves the JSON answer (see OUTLINE_PROVIDER_OPTIONS history). Retry drops to
  // low effort so a truncated first pass has more room for the answer.
  const parsed = (await generateJson({
    model: anthropic(PUBLISHED_CONTENT_MODEL),
    prompt,
    firstBudget: 6000,
    retryBudget: 10000,
    providerOptions: GENERATION_PROVIDER_OPTIONS,
    retryProviderOptions: OUTLINE_PROVIDER_OPTIONS,
    label: 'brand-doc',
    onAttempt: async (usage) => {
      checkTokenBudget('brand-doc', firmName, usage?.inputTokens, 4000)
      await recordTokenUsage({
        task: 'content',
        contentJobId: ctx?.contentJobId,
        sessionId: ctx?.sessionId,
        stage: 'brand',
        pageUrl: 'brand-doc',
        model: 'claude-sonnet-5',
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      })
    },
  })) as Partial<BrandDoc> | null

  if (parsed && nonEmpty(parsed.summary) && nonEmpty(parsed.fullDoc)) {
    return { summary: parsed.summary.trim(), fullDoc: parsed.fullDoc.trim() }
  }
  console.warn(`[brand-doc] LLM returned empty/unparseable fields, using compiled fallback`)
  return fallback
}
