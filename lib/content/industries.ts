// The industry (vertical) a piece of bulk/library content targets. Today every
// firm on the platform is tax & accounting, but the roster is expected to widen
// to other verticals — so content carries an industry tag that operators filter
// by when picking library articles to include in a new site during onboarding.
//
// This mirrors the ContentType dimension in ./content-types.ts: a controlled,
// extensible list. To add a vertical, add it here AND widen the CHECK constraint
// on blog_batches / blog_batch_targets / resource_ideas.industry in a migration.
export type Industry = 'tax-accounting'

export const DEFAULT_INDUSTRY: Industry = 'tax-accounting'

export interface IndustrySpec {
  // Short label for UI selectors and badges.
  uiLabel: string
}

export const INDUSTRIES: Record<Industry, IndustrySpec> = {
  'tax-accounting': { uiLabel: 'Tax & Accounting' },
}

// Selector options for the admin UIs, in presentation order.
export const INDUSTRY_OPTIONS: Array<{ value: Industry; label: string }> = (
  ['tax-accounting'] as Industry[]
).map((value) => ({ value, label: INDUSTRIES[value].uiLabel }))

export function isIndustry(value: unknown): value is Industry {
  return typeof value === 'string' && value in INDUSTRIES
}

// Coerce any stored/incoming value to a valid Industry, defaulting to the base
// vertical. Mirrors asContentType so persistence stays forgiving.
export function asIndustry(value: unknown): Industry {
  return isIndustry(value) ? value : DEFAULT_INDUSTRY
}
