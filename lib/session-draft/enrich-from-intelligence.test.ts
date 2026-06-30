import { describe, expect, it } from 'vitest'
import type { AuditIntelligence } from '@/types/audit-result'
import type { SessionSchema } from '@/types/session-schema'
import { enrichSchemaFromIntelligence } from './enrich-from-intelligence'

function baseSchema(): SessionSchema {
  return {
    business: {
      name: 'Acme', tagline: '', positioningOption: '', positioningStatement: '', foundingYear: '',
      firmHistory: '', idealClients: [], geographicScope: '', clientAgeRanges: [], customerNeeds: '',
      customerDescription: '', differentiators: '', affiliations: [], clientSuccessStories: [],
      clientMixBreakdown: '', howClientsFind: '', pricing: '', growthGoals: '',
    },
    team: [{ name: 'Jane Doe', title: 'Partner', certifications: [], bio: '', specializations: [] }],
    services: [{ name: 'Tax Planning', description: 'x', offerings: [] }],
    niches: [],
    content_gaps: { nicheGaps: [], authorityGaps: [], conversionGaps: [], teamExpertiseGaps: [] },
  }
}

function intel(over: Partial<AuditIntelligence> = {}): AuditIntelligence {
  return {
    niche_services: {
      detected_niches: [], invisible_niches: [], top_improvements: [],
      services_analysis: [
        { service: 'tax planning', clarity: '', framing: '', audience: '', rewrite_direction: 'Lead with proactive strategy.' },
      ],
    } as unknown as AuditIntelligence['niche_services'],
    tech_stack: {
      cms: 'WordPress', page_builder: 'Elementor', hosting: 'WP Engine', frameworks: ['jQuery'],
      risk_flags: [], commentary: 'Standard WP stack.',
    },
    domain: { registered: '2008-04-01', age_years: 18, last_updated: '2026-05-01' },
    content_library: { total_pieces: 12, formats: [{ type: 'blog', count: 12, cadence: 'monthly' }], syndication_assessment: '', recommendations: ['Start a newsletter'] },
    competitive: { keyword_rankings: [{ keyword: 'austin cpa', rank: 7, note: '' }], ai_search_presence: 'none', local_seo: 'weak' } as unknown as AuditIntelligence['competitive'],
    narrative: {
      executive_summary: 'Solid firm, thin web presence.',
      section_commentary: {},
      recommendations: [{ title: 'Rebuild services pages', business_impact: '', counting_five_help: '', priority: 'high' as never }],
    },
    digital_intelligence: {
      personnel: [
        { name: 'Jane Doe', role: 'Partner', footprint: 'high' as never, associations: ['AICPA'], notes: '' },
        { name: 'New Person', role: 'Manager', footprint: 'low' as never, associations: ['TXCPA'], notes: 'Found on LinkedIn' },
      ],
      reputation: { sentiment: '', ratings: [], praise_themes: [], concern_themes: [] },
      affiliations: [], content_footprint: [], social_presence: [],
      niche_gap: { external: [], on_site: [], unleveraged: [] },
    },
    ...over,
  }
}

describe('enrichSchemaFromIntelligence — audit carry-over', () => {
  it('maps rewrite_direction onto the matching service by name', () => {
    const s = baseSchema()
    enrichSchemaFromIntelligence(s, intel())
    expect(s.services?.[0].rewriteDirection).toBe('Lead with proactive strategy.')
  })

  it('merges associations into an existing roster member and adds new personnel with associations', () => {
    const s = baseSchema()
    enrichSchemaFromIntelligence(s, intel())
    const jane = s.team?.find((t) => t.name === 'Jane Doe')
    expect(jane?.associations).toEqual(['AICPA'])
    const np = s.team?.find((t) => t.name === 'New Person')
    expect(np).toBeDefined()
    expect(np?.associations).toEqual(['TXCPA'])
  })

  it('seeds hosting and registration date into typed technical fields', () => {
    const s = baseSchema()
    enrichSchemaFromIntelligence(s, intel())
    expect(s.technical?.hostingProvider).toBe('WP Engine')
    expect(s.technical?.registrationDate).toBe('2008-04-01')
  })

  it('captures un-typed intel into _meta.audit_context', () => {
    const s = baseSchema()
    enrichSchemaFromIntelligence(s, intel())
    const ctx = s._meta?.audit_context
    expect(ctx?.narrative?.executiveSummary).toBe('Solid firm, thin web presence.')
    expect(ctx?.narrative?.recommendations).toEqual(['Rebuild services pages'])
    expect(ctx?.techStack?.cms).toBe('WordPress')
    expect(ctx?.domain?.ageYears).toBe(18)
    expect(ctx?.contentLibrary?.totalPieces).toBe(12)
    expect(ctx?.competitive?.keywordRankings?.[0].keyword).toBe('austin cpa')
  })

  it('maps audit-discovered competitors into business.competitors', () => {
    const s = baseSchema()
    enrichSchemaFromIntelligence(s, intel({
      competitors: {
        competitors: [
          { name: 'Smith CPA', location: 'Austin, TX', size: '', nicheClaim: 'dental', positioningNotes: '' },
        ],
      },
    }))
    expect(s.business?.competitors?.[0].name).toBe('Smith CPA')
    expect(s.business?.competitors?.[0].nicheClaim).toBe('dental')
  })

  it('does not create audit_context when no relevant intel is present', () => {
    const s = baseSchema()
    enrichSchemaFromIntelligence(s, {
      digital_intelligence: {
        personnel: [], reputation: { sentiment: '', ratings: [], praise_themes: [], concern_themes: [] },
        affiliations: [], content_footprint: [], social_presence: [],
        niche_gap: { external: [], on_site: [], unleveraged: [] },
      },
    })
    expect(s._meta?.audit_context).toBeUndefined()
  })
})
