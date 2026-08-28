// ---------------------------------------------------------------------------
// Pricing-plans deliverable emission.
//
// When a session has an enabled pricing_plans row (or the onboarding pricing-page
// preference opts in), the package assembler ships:
//   - content/pricing-plans.json  (the PricingPlansConfig)
//   - content/pages/pricing.md    (a standalone page hosting the block)
//   - a nav entry linking to /pricing
// The Phase II template renders the static <PricingPlans> from the JSON (see
// docs/pricing-plans-contract.md).
// ---------------------------------------------------------------------------
import type { PricingPlansConfig } from '@/types/pricing-plans'

export const PRICING_PLANS_JSON_PATH = 'content/pricing-plans.json'
export const PRICING_PLANS_PAGE_PATH = 'content/pages/pricing.md'
export const PRICING_PLANS_URL = '/pricing'
export const PRICING_PLANS_NAV_LABEL = 'Pricing'

// A standalone markdown page whose single section is the config-driven
// pricing-plans block. Mirrors the annotation shape the template parser expects:
// `<!-- block: id -->` immediately followed by a `## heading`.
export function buildPricingPlansPageMd(
  firmName: string,
  config: PricingPlansConfig
): string {
  const safeFirm = firmName || 'our firm'
  const metaDescription = `Explore ${safeFirm}'s plans and pricing. Compare tiers, see what each includes, and choose the level of support that fits your business.`
  const frontmatter = [
    '---',
    `title: Pricing | ${safeFirm}`,
    `url: ${PRICING_PLANS_URL}`,
    'meta_title: Pricing & Plans',
    `meta_description: ${metaDescription}`,
    'target_keyword: pricing',
    'hero: page-header',
    'hero_subhead: Simple, transparent plans that scale with your business.',
    '---',
  ].join('\n')

  return `${frontmatter}

<!-- block: pricing-plans -->
## Plans & pricing

${config.intro}
`
}

export function pricingPlansJsonEntry(config: PricingPlansConfig): {
  path: string
  content: string
} {
  return { path: PRICING_PLANS_JSON_PATH, content: JSON.stringify(config, null, 2) }
}
