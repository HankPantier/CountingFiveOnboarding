// ---------------------------------------------------------------------------
// Deterministic audit → pricing-config base builders.
//
// The initial audit captures whatever pricing is already on the client's site
// into _meta.audit_context.pricing (see lib/session-draft/draft-from-audit.ts).
// These helpers turn that captured data into a BASE config for the plans page /
// calculator — no AI call — so the shipped page and the admin editor open
// pre-populated with the client's real numbers instead of generic placeholders.
// The operator can always override/edit, or run "Draft with AI" for a richer
// draft (which is also anchored on this same captured pricing).
//
// Both return null when the audit captured nothing usable, so the caller falls
// back to the generic DEFAULT_* config.
// ---------------------------------------------------------------------------
import { DEFAULT_PLANS_CONFIG, type PricingPlansConfig, type PlanTier } from '@/types/pricing-plans'
import { DEFAULT_CALCULATOR_CONFIG, type PricingCalculatorConfig, type PricingServiceLine } from '@/types/pricing-calculator'
import type { SessionSchema } from '@/types/session-schema'
import { normalizePricingPlansConfig } from './pricing-plans-config'
import { normalizePricingConfig } from './pricing-calculator-config'

// Parse a dollar figure out of a free-text price string. Prefers a number that
// follows a currency symbol ("$1,500/mo" → 1500) and understands a trailing
// "k" ("$1.5k" → 1500). Returns null for quote-only labels ("Custom").
export function parsePriceNumber(raw: string | undefined | null): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, '')
  const currencyMatch = cleaned.match(/[$£€]\s*(\d+(?:\.\d+)?)\s*([kK])?/)
  const anyMatch = currencyMatch ?? cleaned.match(/(\d+(?:\.\d+)?)\s*([kK])?/)
  if (!anyMatch) return null
  let n = Number(anyMatch[1])
  if (!isFinite(n)) return null
  if (anyMatch[2]) n *= 1000
  return n
}

// Build a base PricingPlansConfig from captured tier cards. Only the tiers are
// carried over verbatim; add-ons and the "all plans include" list are left empty
// (the DEFAULT ones carry placeholder numbers/claims that may not apply) so the
// only numbers on the page come from the client's own site.
export function buildPlansConfigFromAudit(schema: SessionSchema): PricingPlansConfig | null {
  const captured = schema._meta?.audit_context?.pricing
  const tiersIn = captured?.tiers ?? []
  if (tiersIn.length === 0) return null

  const discount = DEFAULT_PLANS_CONFIG.billing.annualDiscountPct
  const tiers: PlanTier[] = tiersIn.slice(0, 4).map((t, i) => {
    const monthly = parsePriceNumber(t.price)
    const numeric = monthly != null && monthly > 0
    return {
      id: `tier-${i + 1}`,
      name: t.name || `Plan ${i + 1}`,
      monthlyPrice: numeric ? monthly! : 0,
      annualPrice: numeric ? Math.round(monthly! * (1 - discount / 100)) : 0,
      // Non-numeric captured price (e.g. "Custom") becomes the suffix label.
      priceSuffix: numeric ? '/mo' : (t.price?.trim() || 'Custom'),
      isMostPopular: false,
      features: (t.features ?? []).map((f, fi) => ({ id: `feat-${fi + 1}`, label: f, included: true })),
      cta: { ...DEFAULT_PLANS_CONFIG.cta },
    }
  })
  // Highlight the middle tier as a sensible default.
  if (tiers.length >= 3) tiers[Math.floor((tiers.length - 1) / 2)].isMostPopular = true

  const config: PricingPlansConfig = {
    ...DEFAULT_PLANS_CONFIG,
    tiers,
    sharedFeatures: { heading: DEFAULT_PLANS_CONFIG.sharedFeatures.heading, items: [] },
    addOns: [],
  }
  return normalizePricingPlansConfig(config)
}

// Build a base PricingCalculatorConfig from captured per-service rates. Rates map
// to service lines; the DEFAULT size/complexity multipliers are kept (they're
// ratios, not the client's prices) and the placeholder implementation fee +
// add-ons are dropped so no invented dollar figure ships.
export function buildCalculatorConfigFromAudit(schema: SessionSchema): PricingCalculatorConfig | null {
  const captured = schema._meta?.audit_context?.pricing
  const ratesIn = captured?.rates ?? []
  if (ratesIn.length === 0) return null

  const serviceLines: PricingServiceLine[] = ratesIn
    .slice(0, 8)
    .map((r, i) => {
      const line: PricingServiceLine = {
        id: `service-${i + 1}`,
        label: r.service || `Service ${i + 1}`,
        baseRate: parsePriceNumber(r.rate) ?? 0,
        enabledByDefault: false,
      }
      return line
    })
    .filter((s) => s.label)
  if (serviceLines.length === 0) return null

  const config: PricingCalculatorConfig = {
    ...DEFAULT_CALCULATOR_CONFIG,
    serviceLines,
    implementationFee: null,
    addOns: [],
  }
  return normalizePricingConfig(config)
}
