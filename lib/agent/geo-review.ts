import type { SessionSchema } from '@/types/session-schema'

export type GeoScope = 'local' | 'regional' | 'national'
export type GeoAreaInput = { city: string; county?: string; state?: string; primary?: boolean }

// The operator's Phase-3 geographic scope review submitted from the
// GeographyReviewCard. `scope` is the national-vs-local decision; `areas` is the
// confirmed service-area list (ignored/empty for a national scope).
export type GeoReviewInput = { scope: GeoScope; areas?: GeoAreaInput[] }

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '')

// Pure transform: apply a geography review to the schema. Does NOT mutate its
// input. Sets business.serviceScope, replaces business.serviceAreas with the
// confirmed list (deduped, exactly one primary), keeps the free-text
// geographicScope in sync, and records the decision in _meta.geo_review. A
// 'national' scope clears service areas. Idempotent.
export function applyGeoReview(
  schema: SessionSchema,
  input: GeoReviewInput,
  reviewedAt: string,
  reviewedBy?: string,
): SessionSchema {
  const next = structuredClone(schema)
  const business = next.business ?? ({} as NonNullable<SessionSchema['business']>)

  business.serviceScope = input.scope

  if (input.scope === 'national') {
    business.serviceAreas = []
    if (!clean(business.geographicScope)) {
      business.geographicScope = 'Works nationally'
    }
  } else {
    // Dedup by city+state, keep the first-seen entry, force a single primary.
    const seen = new Set<string>()
    const areas: NonNullable<SessionSchema['business']>['serviceAreas'] = []
    for (const raw of input.areas ?? []) {
      const city = clean(raw.city)
      if (!city) continue
      const key = `${city.toLowerCase()}|${clean(raw.state).toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const entry: NonNullable<NonNullable<SessionSchema['business']>['serviceAreas']>[number] = { city }
      if (clean(raw.county)) entry.county = clean(raw.county)
      if (clean(raw.state)) entry.state = clean(raw.state)
      areas.push(entry)
    }
    const primaryIdx = (input.areas ?? []).findIndex((a) => a.primary && clean(a.city))
    if (areas.length) areas[primaryIdx >= 0 ? Math.min(primaryIdx, areas.length - 1) : 0].primary = true
    business.serviceAreas = areas

    if (!clean(business.geographicScope)) {
      const primary = areas.find((a) => a.primary) ?? areas[0]
      if (primary) {
        business.geographicScope = `Serves ${[primary.city, primary.state].filter(Boolean).join(', ')} and surrounding ${input.scope === 'regional' ? 'region' : 'area'}`
      }
    }
  }

  next.business = business
  next._meta = {
    ...(next._meta ?? {
      phase3_completed_chunks: [],
      phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
      phase4_flagged_for_followup: [],
      admin_overrides: {},
    }),
    geo_review: {
      reviewedAt,
      scope: input.scope,
      areaCount: business.serviceAreas?.length ?? 0,
      ...(reviewedBy ? { reviewedBy } : {}),
    },
  }

  return next
}
