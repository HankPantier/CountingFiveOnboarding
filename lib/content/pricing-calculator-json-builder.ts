// ---------------------------------------------------------------------------
// Pricing-calculator deliverable emission.
//
// When a session has an enabled pricing_calculators row, the package assembler
// ships three artifacts to the client repo:
//   - content/pricing-calculator.json  (the PricingCalculatorConfig)
//   - content/pages/pricing-calculator.md  (a standalone page hosting the block)
//   - a nav entry linking to /pricing-calculator
// The Phase II template renders the interactive <PricingCalculator> from the
// JSON (see docs/pricing-calculator-contract.md).
// ---------------------------------------------------------------------------
import type { PricingCalculatorConfig } from '@/types/pricing-calculator'

export const PRICING_CALCULATOR_JSON_PATH = 'content/pricing-calculator.json'
export const PRICING_CALCULATOR_PAGE_PATH = 'content/pages/pricing-calculator.md'
export const PRICING_CALCULATOR_URL = '/pricing-calculator'
export const PRICING_CALCULATOR_NAV_LABEL = 'Pricing Calculator'

// A standalone markdown page whose single section is the config-driven
// pricing-calculator block. Mirrors the annotation shape the template parser
// expects: `<!-- block: id -->` immediately followed by a `## heading`.
export function buildPricingCalculatorPageMd(
  firmName: string,
  config: PricingCalculatorConfig
): string {
  const safeFirm = firmName || 'our firm'
  const metaDescription = `Estimate the monthly cost of working with ${safeFirm}. Adjust the services and options for a ballpark figure, then book a consultation.`
  // Frontmatter mirrors the generated-page contract; the template tolerates
  // missing fields, but title/url/hero keep routing + the page header correct.
  const frontmatter = [
    '---',
    `title: Pricing Calculator | ${safeFirm}`,
    `url: ${PRICING_CALCULATOR_URL}`,
    'meta_title: Pricing Calculator',
    `meta_description: ${metaDescription}`,
    'target_keyword: pricing',
    'hero: page-header',
    'hero_subhead: Transparent, tailored to your business.',
    '---',
  ].join('\n')

  return `${frontmatter}

<!-- block: pricing-calculator -->
## Estimate your investment

${config.intro}
`
}

export function pricingCalculatorJsonEntry(config: PricingCalculatorConfig): {
  path: string
  content: string
} {
  return { path: PRICING_CALCULATOR_JSON_PATH, content: JSON.stringify(config, null, 2) }
}
