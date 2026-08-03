// ---------------------------------------------------------------------------
// Pricing Calculator — the standardized per-client config contract.
//
// Every client site's interactive pricing calculator shares THIS shape; only
// the numbers differ per firm. Captured in the admin editor, stored in the
// `pricing_calculators` table (one row per session), and emitted at package
// time as `content/pricing-calculator.json`. The Phase II template mirrors this
// type in src/lib/content/pricing-calculator-types.ts — keep the two in sync
// (see docs/pricing-calculator-contract.md).
// ---------------------------------------------------------------------------

export interface PricingServiceLine {
  id: string
  label: string
  // Monthly base rate added when this line is selected (before multipliers).
  baseRate: number
  enabledByDefault: boolean
  description?: string
}

// A driver rendered as a single-choice control (business size, complexity).
// Its selected option's multiplier scales the summed service-line rates.
export interface PricingMultiplierOption {
  id: string
  label: string
  multiplier: number
}

// Add-ons apply AFTER the multipliers: a flat monthly fee, or a per-unit rate
// times a visitor-supplied quantity.
export type PricingAddOn =
  | { id: string; label: string; type: 'flat'; flatRate: number; description?: string }
  | { id: string; label: string; type: 'per-unit'; unitRate: number; unitLabel: string; description?: string }

export interface PricingImplementationFee {
  amount: number
  label: string
  weeks?: string
}

export interface PricingCalculatorConfig {
  version: 1
  currency: string // ISO 4217, e.g. "USD"
  billingPeriod: 'month' | 'year'
  intro: string
  implementationFee: PricingImplementationFee | null
  serviceLines: PricingServiceLine[]
  sizeTiers: PricingMultiplierOption[]
  complexityLevels: PricingMultiplierOption[]
  addOns: PricingAddOn[]
  // The estimate is shown as a ± band of this many percent to signal it's an
  // estimate, not a quote (e.g. 15 → "~$X–$Y / month").
  estimateBandPct: number
  disclaimer: string
  cta: { label: string; url: string }
}

// Sensible starting point so every session's editor opens populated and a
// client who never customizes still ships a working (placeholder) calculator.
// Modeled on the four service lines the reference (unity.cpa) exposes.
export const DEFAULT_CALCULATOR_CONFIG: PricingCalculatorConfig = {
  version: 1,
  currency: 'USD',
  billingPeriod: 'month',
  intro: 'Estimate your monthly investment. Adjust the options below for a ballpark figure — your final quote depends on the specifics of your engagement.',
  implementationFee: { amount: 2499, label: 'One-time setup & onboarding', weeks: '4-6' },
  serviceLines: [
    { id: 'bookkeeping', label: 'Bookkeeping & Accounting', baseRate: 199, enabledByDefault: false, description: 'Monthly reconciliation, financial statements, and clean books.' },
    { id: 'tax', label: 'Tax Planning & Preparation', baseRate: 250, enabledByDefault: false, description: 'Proactive planning plus business and owner return prep.' },
    { id: 'payroll', label: 'Payroll', baseRate: 99, enabledByDefault: false, description: 'Run payroll, filings, and year-end forms.' },
    { id: 'advisory', label: 'Advisory / Fractional CFO', baseRate: 500, enabledByDefault: false, description: 'Cash-flow strategy, forecasting, and decision support.' },
  ],
  sizeTiers: [
    { id: 'solo', label: 'Solo / under $250k revenue', multiplier: 1.0 },
    { id: 'small', label: '$250k – $1M revenue', multiplier: 1.5 },
    { id: 'growing', label: '$1M – $5M revenue', multiplier: 2.25 },
  ],
  complexityLevels: [
    { id: 'basic', label: 'Basic', multiplier: 1.0 },
    { id: 'standard', label: 'Standard', multiplier: 1.3 },
    { id: 'complex', label: 'Complex', multiplier: 1.7 },
  ],
  addOns: [
    { id: 'payroll-emp', label: 'Additional payroll employees', type: 'per-unit', unitRate: 8, unitLabel: 'employee' },
    { id: 'multistate', label: 'Multi-state tax filing', type: 'flat', flatRate: 75 },
  ],
  estimateBandPct: 15,
  disclaimer: 'This estimate may not include all elements of a potential engagement. Contact us for a detailed quote.',
  cta: { label: 'Book a consultation', url: '/contact' },
}
