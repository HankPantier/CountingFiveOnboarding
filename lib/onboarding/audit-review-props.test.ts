import { describe, expect, it } from 'vitest'
import { buildAuditReviewProps } from './audit-review-props'
import type { SessionSchema } from '@/types/session-schema'

const emptyMeta = {
  phase3_completed_chunks: [],
  phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
  phase4_flagged_for_followup: [],
  admin_overrides: {},
}

describe('buildAuditReviewProps', () => {
  it('attaches AI suggestions by name and pre-selects them', () => {
    const schema = {
      services: [{ name: 'Bookkeeping', description: 'desc', offerings: [], origin: 'site' }],
      niches: [{ name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '', origin: 'site' }],
      _meta: {
        ...emptyMeta,
        audit_suggestions: {
          services: [{ name: 'Bookkeeping', treatment: 'block', parent: '/services/tax', rationale: 'Thin.', confidence: 'low' }],
          niches: [{ name: 'Dental', treatment: 'page', rationale: 'Strong.' }],
          geoScope: { scope: 'local', rationale: 'Local.', primaryArea: 'Nashua' },
          generatedAt: 'x',
        },
      },
    } as unknown as SessionSchema
    const props = buildAuditReviewProps(schema)
    const svc = props.services[0]
    expect(svc.treatment).toBe('block')
    expect(svc.parent).toBe('/services/tax')
    expect(svc.suggestion).toMatchObject({ treatment: 'block', rationale: 'Thin.', confidence: 'low' })
    expect(props.niches[0].treatment).toBe('page')
    expect(props.geo.suggestedScope).toBe('local')
    expect(props.geo.suggestedPrimaryArea).toBe('Nashua')
    expect(props.geo.suggestionRationale).toBe('Local.')
  })

  it('lets a prior human decision win over the suggestion', () => {
    const schema = {
      services: [{ name: 'Bookkeeping', description: '', offerings: [], origin: 'site', status: 'kept', pageTreatment: 'page' }],
      _meta: { ...emptyMeta, audit_suggestions: { services: [{ name: 'Bookkeeping', treatment: 'exclude', rationale: 'r' }], generatedAt: 'x' } },
    } as unknown as SessionSchema
    expect(buildAuditReviewProps(schema).services[0].treatment).toBe('page')
  })

  it('falls back to an undefined treatment (origin default) when there is no suggestion', () => {
    const schema = { services: [{ name: 'X', description: '', offerings: [], origin: 'site' }] } as unknown as SessionSchema
    expect(buildAuditReviewProps(schema).services[0].treatment).toBeUndefined()
    expect(buildAuditReviewProps(schema).services[0].suggestion).toBeUndefined()
  })

  it('surfaces audit-recommended niches with their suggestion', () => {
    const schema = {
      niches: [],
      _meta: {
        ...emptyMeta,
        opportunities: { audienceOpportunities: [], serviceOpportunities: [], highOpportunityNiches: ['Construction'] },
        audit_suggestions: { niches: [{ name: 'Construction', treatment: 'page', rationale: 'Untapped gap.' }], generatedAt: 'x' },
      },
    } as unknown as SessionSchema
    const c = buildAuditReviewProps(schema).niches.find((n) => n.name === 'Construction')!
    expect(c.origin).toBe('audit')
    expect(c.treatment).toBe('page')
    expect(c.suggestion?.rationale).toBe('Untapped gap.')
  })

  it('surfaces audit-proposed services and sub-services as origin audit (#5)', () => {
    const schema = {
      services: [{ name: 'Bookkeeping', description: '', offerings: [], origin: 'site' }],
      niches: [{ name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '', origin: 'site', subCategories: [{ name: 'Cleanings', status: 'confirmed' }] }],
      _meta: {
        ...emptyMeta,
        audit_suggestions: {
          services: [{ name: 'CFO Advisory', treatment: 'page', rationale: 'New demand.' }],
          subCategories: [{ niche: 'Dental', name: 'Implants', treatment: 'block', rationale: 'Worth adding.' }],
          generatedAt: 'x',
        },
      },
    } as unknown as SessionSchema
    const props = buildAuditReviewProps(schema)
    const proposedSvc = props.services.find((s) => s.name === 'CFO Advisory')
    expect(proposedSvc).toMatchObject({ origin: 'audit', treatment: 'page' })
    const dental = props.subGroups.find((g) => g.niche === 'Dental')!
    expect(dental.subs.find((s) => s.name === 'Implants')).toMatchObject({ origin: 'audit', treatment: 'block' })
  })

  it('threads a team suggestion onto the member', () => {
    const schema = {
      team: [{ name: 'Ann', title: 'CPA', certifications: [], bio: '', specializations: [] }],
      _meta: { ...emptyMeta, audit_suggestions: { team: [{ name: 'Ann', decision: 'remove', rationale: 'No presence.' }], generatedAt: 'x' } },
    } as unknown as SessionSchema
    expect(buildAuditReviewProps(schema).team[0].suggestion).toEqual({ decision: 'remove', rationale: 'No presence.' })
  })
})
