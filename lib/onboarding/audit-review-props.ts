import type { SessionSchema } from '@/types/session-schema'
import type { ReviewItem, ReviewSubGroup } from '@/components/admin/onboarding/AuditReview'
import type { ReviewTeamMember } from '@/components/admin/onboarding/TeamReviewList'
import type { ReviewArea, GeoScope } from '@/components/admin/onboarding/GeoScopeControl'
import type { ItemSuggestion, Confidence } from '@/components/admin/onboarding/AuditReviewItemRow'

// Splits the audit-seeded schema into the Audit Review step's four areas, each in
// two batches (origin 'site' vs 'audit'), and joins the AI's per-item suggestions
// (_meta.audit_suggestions, keyed by name) so each item opens PRE-SELECTED to the
// AI's recommendation with its rationale. Pure + exported so it can be unit-tested
// independently of the server component that renders it.
//
// Initial-treatment precedence, per item:
//   prior human decision (status/pageTreatment) → AI suggestion → origin default.
// So a re-visit shows the operator's earlier pick; a first visit shows the AI's.

export interface AuditReviewProps {
  services: ReviewItem[]
  niches: ReviewItem[]
  subGroups: ReviewSubGroup[]
  team: ReviewTeamMember[]
  geo: {
    scope?: GeoScope
    areas: ReviewArea[]
    suggestedScope?: GeoScope
    suggestedPrimaryArea?: string
    suggestionRationale?: string
    suggestionConfidence?: Confidence
  }
}

const norm = (s: string): string => s.trim().toLowerCase()

type TreatmentSource = { status?: string; pageTreatment?: 'page' | 'block' | 'exclude' }
const treatmentOf = (item: TreatmentSource): 'page' | 'block' | 'exclude' | undefined =>
  item.status === 'dropped' ? 'exclude' : item.pageTreatment

type ItemSug = NonNullable<NonNullable<SessionSchema['_meta']>['audit_suggestions']>['services'] extends (infer U)[] | undefined
  ? U
  : never

// Build the display `suggestion` object the row shows, from a stored suggestion.
const toItemSuggestion = (s: ItemSug | undefined): ItemSuggestion | undefined =>
  s ? { treatment: s.treatment, rationale: s.rationale, ...(s.confidence ? { confidence: s.confidence } : {}), ...(s.parent ? { parent: s.parent } : {}) } : undefined

export function buildAuditReviewProps(schema: SessionSchema): AuditReviewProps {
  const sug = schema._meta?.audit_suggestions
  const serviceSug = new Map((sug?.services ?? []).map((s) => [norm(s.name), s]))
  const nicheSug = new Map((sug?.niches ?? []).map((s) => [norm(s.name), s]))
  const subSug = new Map((sug?.subCategories ?? []).map((s) => [`${norm(s.niche)}::${norm(s.name)}`, s]))
  const teamSug = new Map((sug?.team ?? []).map((s) => [norm(s.name), s]))

  const services: ReviewItem[] = (schema.services ?? [])
    .filter((s) => !!s && typeof s === 'object' && !!s.name?.trim())
    .map((s) => {
      const g = serviceSug.get(norm(s.name))
      return {
        name: s.name,
        origin: s.origin ?? 'site',
        note: s.description?.trim() || undefined,
        treatment: treatmentOf(s) ?? g?.treatment,
        parent: s.parent ?? g?.parent,
        suggestion: toItemSuggestion(g),
      }
    })
  // Audit-PROPOSED services (a suggestion whose name isn't on the site yet) → the
  // "Recommended from the audit" batch (improvement #5).
  const servicePresent = new Set(services.map((s) => norm(s.name)))
  for (const g of sug?.services ?? []) {
    if (!g.name?.trim() || servicePresent.has(norm(g.name))) continue
    services.push({ name: g.name, origin: 'audit', treatment: g.treatment, parent: g.parent, suggestion: toItemSuggestion(g) })
  }

  const nicheList = (schema.niches ?? []).filter((n) => !!n && typeof n === 'object' && !!n.name?.trim())
  const present = new Set(nicheList.map((n) => norm(n.name)))
  const highOpp = (schema._meta?.opportunities?.highOpportunityNiches ?? []).filter(
    (name) => name?.trim() && !present.has(norm(name)),
  )
  const niches: ReviewItem[] = [
    ...nicheList.map((n) => {
      const g = nicheSug.get(norm(n.name))
      return {
        name: n.name,
        origin: n.origin ?? 'site',
        note: (n.valueProp || n.description || '').trim() || undefined,
        signal: n.signal,
        treatment: treatmentOf(n) ?? g?.treatment,
        parent: n.parent ?? g?.parent,
        suggestion: toItemSuggestion(g),
      }
    }),
    ...highOpp.map((name) => {
      const g = nicheSug.get(norm(name))
      return {
        name,
        origin: 'audit' as const,
        treatment: g?.treatment,
        parent: g?.parent,
        suggestion: toItemSuggestion(g),
      }
    }),
  ]

  const subGroups: ReviewSubGroup[] = nicheList
    .filter((n) => n.status !== 'dropped')
    .map((n) => {
      const existing = (n.subCategories ?? [])
        .filter((s) => !!s && typeof s === 'object' && !!s.name?.trim())
        .map((s) => {
          const g = subSug.get(`${norm(n.name)}::${norm(s.name)}`)
          return { name: s.name, origin: (s.origin ?? 'site') as 'site' | 'audit', treatment: treatmentOf(s) ?? g?.treatment, suggestion: toItemSuggestion(g) }
        })
      // Audit-PROPOSED sub-services under this niche (improvement #5).
      const present = new Set(existing.map((s) => norm(s.name)))
      const proposed = (sug?.subCategories ?? [])
        .filter((g) => norm(g.niche) === norm(n.name) && g.name?.trim() && !present.has(norm(g.name)))
        .map((g) => ({ name: g.name, origin: 'audit' as const, treatment: g.treatment, suggestion: toItemSuggestion(g) }))
      return { niche: n.name, subs: [...existing, ...proposed] }
    })
    .filter((grp) => grp.subs.length > 0)

  const team: ReviewTeamMember[] = (schema.team ?? [])
    .filter((t) => !!t && typeof t === 'object' && !!t.name?.trim() && t.teamDecision !== 'remove')
    .map((t) => {
      const g = teamSug.get(norm(t.name))
      return {
        name: t.name,
        title: t.title?.trim() || undefined,
        ...(g ? { suggestion: { decision: g.decision, rationale: g.rationale, ...(g.confidence ? { confidence: g.confidence } : {}) } } : {}),
      }
    })

  const geoSug = sug?.geoScope
  const geo: AuditReviewProps['geo'] = {
    scope: schema.business?.serviceScope,
    areas: (schema.business?.serviceAreas ?? [])
      .filter((a) => !!a && typeof a === 'object' && !!a.city?.trim())
      .map((a) => ({ city: a.city, county: a.county, state: a.state, primary: a.primary })),
    ...(geoSug
      ? {
          suggestedScope: geoSug.scope,
          ...(geoSug.primaryArea ? { suggestedPrimaryArea: geoSug.primaryArea } : {}),
          suggestionRationale: geoSug.rationale,
          ...(geoSug.confidence ? { suggestionConfidence: geoSug.confidence } : {}),
        }
      : {}),
  }

  return { services, niches, subGroups, team, geo }
}
