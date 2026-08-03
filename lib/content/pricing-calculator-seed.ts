// ---------------------------------------------------------------------------
// AI seed for the pricing calculator — a convenience that drafts starting
// numbers from the firm's free-text pricing (business.pricing) + services. The
// operator always reviews/edits before saving; this only pre-fills the editor.
//
// Model tier: Haiku 4.5 (structured extraction). CLAUDE.md: NEVER send `effort`
// or the generation provider-options object to a Haiku call — it errors.
// ---------------------------------------------------------------------------
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { recordTokenUsage } from './token-usage'
import { normalizePricingConfig } from './pricing-calculator-config'
import { DEFAULT_CALCULATOR_CONFIG, type PricingCalculatorConfig } from '@/types/pricing-calculator'
import type { SessionSchema } from '@/types/session-schema'

const SEED_MODEL = 'claude-haiku-4-5-20251001'

function buildServicesBlock(schema: SessionSchema): string {
  const services = (schema.services ?? [])
    .map(s => `- ${s.name}${s.description ? `: ${s.description}` : ''}`)
    .join('\n')
  return services || '(no structured services captured)'
}

// Draft a PricingCalculatorConfig from the firm's known pricing signals. Falls
// back to DEFAULT_CALCULATOR_CONFIG on any failure — the seed is best-effort and
// must never block the editor.
export async function seedPricingCalculator(args: {
  schema: SessionSchema
  sessionId: string
  contentJobId: string | null
}): Promise<PricingCalculatorConfig> {
  const { schema } = args
  const firmName = schema.business?.name ?? 'this CPA firm'
  const pricingText = schema.business?.pricing?.trim() || '(no pricing notes captured)'

  const prompt = `You are configuring an interactive pricing calculator for ${firmName}, an accounting firm.

Fill in realistic starting NUMBERS for a standard calculator using what's known about the firm. Keep the fixed structure — do not invent new fields.

FIRM PRICING NOTES:
${pricingText}

FIRM SERVICES:
${buildServicesBlock(schema)}

Return ONLY JSON matching exactly this shape (monthly USD rates; multipliers scale the summed selected service rates):
{
  "intro": "one friendly sentence introducing the estimate",
  "implementationFee": { "amount": <one-time setup $ or 0>, "label": "One-time setup", "weeks": "4-6" },
  "serviceLines": [ { "id": "kebab-case", "label": "Service name", "baseRate": <monthly $>, "enabledByDefault": false, "description": "short" } ],
  "sizeTiers": [ { "id": "kebab", "label": "Business size band", "multiplier": <e.g. 1.0> } ],
  "complexityLevels": [ { "id": "kebab", "label": "Basic|Standard|Complex", "multiplier": <e.g. 1.0> } ],
  "addOns": [ { "id": "kebab", "label": "Add-on", "type": "flat", "flatRate": <$> } ],
  "disclaimer": "one sentence that this is an estimate",
  "cta": { "label": "Book a consultation", "url": "/contact" }
}

Rules: 2-5 serviceLines drawn from the firm's actual services; 3 sizeTiers; exactly 3 complexityLevels (Basic 1.0, Standard ~1.3, Complex ~1.7); 0-3 addOns. Base the numbers on the pricing notes when they give figures, otherwise use sensible small-firm defaults. Output JSON only, no prose.`

  try {
    const { text, usage } = await generateText({
      model: anthropic(SEED_MODEL),
      system: 'You configure pricing calculators for accounting firms. Return JSON only, no prose.',
      prompt,
      maxOutputTokens: 1200,
    })
    await recordTokenUsage({
      task: 'content',
      contentJobId: args.contentJobId ?? undefined,
      sessionId: args.sessionId,
      stage: 'idea',
      pageUrl: 'pricing-calculator-seed',
      model: SEED_MODEL,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    })

    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    // Merge over the default so any field the model omitted keeps a sane value,
    // then normalize (which enforces the full shape + bounds).
    return normalizePricingConfig({ ...DEFAULT_CALCULATOR_CONFIG, ...parsed, version: 1 })
  } catch (err) {
    console.warn('[pricing-seed] Seed failed, returning default config:', err)
    return DEFAULT_CALCULATOR_CONFIG
  }
}
