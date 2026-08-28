// ---------------------------------------------------------------------------
// Pricing Plans — the standardized per-client static tier-cards contract.
//
// Every client site's plans/pricing page (/pricing) shares THIS shape; only the
// copy and numbers differ per firm. Captured in the admin "Plans" editor, stored
// in the `pricing_plans` table (one row per session), and emitted at package
// time as `content/pricing-plans.json`. The Phase II template mirrors this type
// in src/lib/content/pricing-plans-types.ts — keep the two in sync (see
// docs/pricing-plans-contract.md).
//
// Distinct from the interactive pricing calculator (types/pricing-calculator.ts,
// /pricing-calculator): plans are static cards (like gatherup.com/pricing and
// dillonadvisors.com/plans); the calculator is an interactive estimate. A
// session may ship both.
// ---------------------------------------------------------------------------

// A single feature line inside a plan card. `included: false` renders greyed /
// struck-through so tiers can show what they DON'T carry versus higher tiers.
export interface PlanFeature {
  id: string
  label: string
  included: boolean
}

// One pricing tier card. `monthlyPrice` / `annualPrice` are both per-month
// figures (annual already reflects the discount) so the billing toggle swaps
// the displayed number without client-side math. Use 0 with a `priceSuffix`
// like "Custom" for quote-only tiers.
export interface PlanTier {
  id: string
  name: string
  description?: string
  monthlyPrice: number
  annualPrice: number
  // Rendered after the price, e.g. "/mo", "starting", "Custom". When set to a
  // non-numeric label like "Custom", the template hides the numeric price.
  priceSuffix?: string
  isMostPopular: boolean
  features: PlanFeature[]
  cta: { label: string; url: string }
}

// Add-ons shown below the tiers. `flat` is a fixed recurring/one-time fee;
// `per-unit` is a rate the copy explains (no interactive quantity here — that's
// the calculator's job).
export type PlanAddOn =
  | { id: string; label: string; type: 'flat'; price: number; cadence: 'month' | 'year' | 'once'; description?: string }
  | { id: string; label: string; type: 'per-unit'; unitPrice: number; unitLabel: string; description?: string }

export interface PlanBilling {
  showToggle: boolean
  defaultCadence: 'monthly' | 'annual'
  // Drives the "save X%" label next to the toggle; presentation only (prices are
  // stored pre-discounted per tier).
  annualDiscountPct: number
  monthlyLabel: string
  annualLabel: string
}

export interface PricingPlansConfig {
  version: 1
  currency: string // ISO 4217, e.g. "USD"
  intro: string
  billing: PlanBilling
  tiers: PlanTier[]
  // The shared "All plans include" block below the cards.
  sharedFeatures: { heading: string; items: string[] }
  addOns: PlanAddOn[]
  disclaimer: string
  // Page-level fallback CTA (each tier also carries its own).
  cta: { label: string; url: string }
}

// Sensible starting point so every session's editor opens populated and a client
// who never customizes still ships a coherent (placeholder) plans page. Three
// tiers with the middle one flagged most-popular, mirroring the reference sites.
export const DEFAULT_PLANS_CONFIG: PricingPlansConfig = {
  version: 1,
  currency: 'USD',
  intro: 'Simple, transparent plans that scale with your business. Choose the level of support that fits where you are today.',
  billing: {
    showToggle: true,
    defaultCadence: 'monthly',
    annualDiscountPct: 15,
    monthlyLabel: 'Monthly',
    annualLabel: 'Annual',
  },
  tiers: [
    {
      id: 'starter',
      name: 'Starter',
      description: 'Clean books and the essentials, handled.',
      monthlyPrice: 299,
      annualPrice: 254,
      priceSuffix: '/mo',
      isMostPopular: false,
      features: [
        { id: 'bookkeeping', label: 'Monthly bookkeeping & reconciliation', included: true },
        { id: 'statements', label: 'Financial statements', included: true },
        { id: 'tax-filing', label: 'Annual business tax filing', included: true },
        { id: 'advisory', label: 'Quarterly advisory call', included: false },
        { id: 'cfo', label: 'Fractional CFO support', included: false },
      ],
      cta: { label: 'Get started', url: '/contact' },
    },
    {
      id: 'growth',
      name: 'Growth',
      description: 'Proactive support for a growing business.',
      monthlyPrice: 599,
      annualPrice: 509,
      priceSuffix: '/mo',
      isMostPopular: true,
      features: [
        { id: 'bookkeeping', label: 'Monthly bookkeeping & reconciliation', included: true },
        { id: 'statements', label: 'Financial statements', included: true },
        { id: 'tax-filing', label: 'Business & owner tax filing', included: true },
        { id: 'advisory', label: 'Quarterly advisory call', included: true },
        { id: 'cfo', label: 'Fractional CFO support', included: false },
      ],
      cta: { label: 'Get started', url: '/contact' },
    },
    {
      id: 'premier',
      name: 'Premier',
      description: 'Strategic finance leadership on demand.',
      monthlyPrice: 1200,
      annualPrice: 1020,
      priceSuffix: '/mo',
      isMostPopular: false,
      features: [
        { id: 'bookkeeping', label: 'Monthly bookkeeping & reconciliation', included: true },
        { id: 'statements', label: 'Financial statements', included: true },
        { id: 'tax-filing', label: 'Business & owner tax filing', included: true },
        { id: 'advisory', label: 'Monthly advisory call', included: true },
        { id: 'cfo', label: 'Fractional CFO support', included: true },
      ],
      cta: { label: 'Book a consultation', url: '/contact' },
    },
  ],
  sharedFeatures: {
    heading: 'All plans include',
    items: [
      'A dedicated accountant who knows your business',
      'Secure cloud document portal',
      'Responsive email & phone support',
      'Year-round tax planning',
    ],
  },
  addOns: [
    { id: 'payroll', label: 'Payroll processing', type: 'flat', price: 99, cadence: 'month', description: 'Run payroll, filings, and year-end forms.' },
    { id: 'catch-up', label: 'Catch-up bookkeeping', type: 'flat', price: 500, cadence: 'once', description: 'Bring prior months current before we begin.' },
  ],
  disclaimer: 'Plans are a starting point — your final quote depends on the specifics of your engagement. Contact us for a tailored proposal.',
  cta: { label: 'Book a consultation', url: '/contact' },
}
