import { describe, expect, it } from 'vitest'
import { buildFirmContext } from './brand-voice'
import type { SessionSchema } from '@/types/session-schema'

const base = (over: Partial<SessionSchema['business']> = {}, rest: Partial<SessionSchema> = {}): SessionSchema => ({
  business: {
    name: 'Acme CPA', tagline: 'Numbers you can trust', positioningOption: '', positioningStatement: '',
    foundingYear: '2005', firmHistory: '', idealClients: [], geographicScope: '', clientAgeRanges: [],
    customerNeeds: '', customerDescription: '', differentiators: '', affiliations: [], clientSuccessStories: [],
    clientMixBreakdown: '', howClientsFind: '', pricing: '', growthGoals: '',
    ...over,
  } as SessionSchema['business'],
  ...rest,
})

describe('buildFirmContext — enriched MBP fields', () => {
  it('includes tagline and growth goals', () => {
    const out = buildFirmContext(base({ growthGoals: 'Double headcount by 2028' }))
    expect(out).toContain('Tagline: Numbers you can trust')
    expect(out).toContain('Growth goals: Double headcount by 2028')
  })

  it('includes per-niche pain points and value props, not just names', () => {
    const out = buildFirmContext(base({}, {
      niches: [{ name: 'Dental practices', description: '', icp: '', painPoints: 'cash flow swings', valueProp: 'specialized tax planning' }],
    }))
    expect(out).toContain('Dental practices')
    expect(out).toContain('pain: cash flow swings')
    expect(out).toContain('value: specialized tax planning')
  })

  it('includes client success stories as proof', () => {
    const out = buildFirmContext(base({ clientSuccessStories: ['Saved a client $40k in taxes'] }))
    expect(out).toContain('Client success stories')
    expect(out).toContain('Saved a client $40k in taxes')
  })

  it('includes reputation signals', () => {
    const out = buildFirmContext(base({}, {
      reputation: { googleRating: '4.9', reviewSummary: 'Clients praise responsiveness', trustSignalGaps: [], pressAndMedia: [] },
    }))
    expect(out).toContain('Reputation & trust signals')
    expect(out).toContain('Google 4.9')
    expect(out).toContain('responsiveness')
  })

  it('includes competitors with a do-not-name caveat', () => {
    const out = buildFirmContext(base({
      competitors: [{ name: 'Smith CPA', location: 'Austin, TX', size: '', nicheClaim: 'dental', positioningNotes: 'budget firm' }],
    }))
    expect(out).toContain('Local competitors')
    expect(out).toContain('do NOT name them')
    expect(out).toContain('Smith CPA')
  })

  it('returns empty string when nothing is populated', () => {
    expect(buildFirmContext({})).toBe('')
  })

  it('renders a CONTENT SCOPE block with emphasis and a hard exclusion rule', () => {
    const out = buildFirmContext(base({
      contentEmphasis: ['nonprofits', 'dental practices'],
      contentExclusions: ['real estate', 'cryptocurrency'],
    }))
    expect(out).toContain('CONTENT SCOPE')
    expect(out).toContain('Emphasize / prioritize: nonprofits, dental practices')
    expect(out).toContain('DO NOT create any page, section, or copy about')
    expect(out).toContain('real estate, cryptocurrency')
  })

  it('emits the scope block even when no firm profile fields are set', () => {
    const out = buildFirmContext({ business: { contentExclusions: ['real estate'] } as SessionSchema['business'] })
    expect(out).toContain('CONTENT SCOPE')
    expect(out).toContain('real estate')
    expect(out).not.toContain('FIRM PROFILE')
  })
})
