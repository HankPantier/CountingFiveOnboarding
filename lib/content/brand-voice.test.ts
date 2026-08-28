import { describe, expect, it } from 'vitest'
import { buildFirmContext, buildBrandVoiceBlock, buildCredentials } from './brand-voice'
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

  // Regression: stored schema_data occasionally holds a non-string where the
  // schema declares `string` (from an AI draft/import). Calling `.trim()` on it
  // threw a TypeError that both the outline and page-body generators swallowed
  // into a generic "generation failed" note. buildFirmContext must degrade, not throw.
  it('does not throw when string-typed schema fields hold arrays/objects', () => {
    const dirty = base(
      {
        // reputation review as an array; competitor claim as an array
        competitors: [{ name: 'Smith CPA', location: '', size: '', nicheClaim: ['dental', 'legal'], positioningNotes: { note: 'budget' } }],
        clientSuccessStories: [['Saved $40k'], 'Grew revenue 3x'],
      } as unknown as SessionSchema['business'],
      {
        niches: [{ name: 'Dental practices', description: '', icp: '', painPoints: ['cash flow swings', 'AR aging'], valueProp: 42 }],
        reputation: { googleRating: 4.9, reviewSummary: ['praise', 'responsive'], trustSignalGaps: [], pressAndMedia: [] },
      } as unknown as Partial<SessionSchema>,
    )
    let out = ''
    expect(() => { out = buildFirmContext(dirty) }).not.toThrow()
    // array painPoints flattened to a comma list; non-string valueProp dropped
    expect(out).toContain('pain: cash flow swings, AR aging')
    expect(out).not.toContain('value:')
    expect(out).toContain('Smith CPA')
  })

  // Regression (client 07df2372): stored schema_data held an ARRAY-typed field
  // as a non-array (string), e.g. idealClients: 'contractors'. `?? []` only
  // guards null/undefined, so the string slipped through and `.filter` threw
  // "(t ?? []).filter is not a function" — crashing ALL outline generation.
  // Every schema array read must coerce, not just the scalar ones.
  it('does not throw when array-typed schema fields hold non-arrays', () => {
    const dirty = base(
      {
        idealClients: 'contractors and nonprofits',
        clientAgeRanges: '35-55',
        affiliations: 'AICPA',
        clientSuccessStories: 'Saved a client $40k',
        contentEmphasis: 'nonprofits',
        contentExclusions: 'crypto',
        competitors: 'Smith CPA',
      } as unknown as SessionSchema['business'],
      {
        services: 'Bookkeeping, Tax',
        niches: 'Dental practices',
        team: 'Jane Doe',
        reputation: { googleRating: '4.9', reviewSummary: 'great', trustSignalGaps: [], pressAndMedia: 'Featured in Forbes' },
      } as unknown as Partial<SessionSchema>,
    )
    let out = ''
    expect(() => { out = buildFirmContext(dirty) }).not.toThrow()
    expect(() => buildCredentials(dirty)).not.toThrow()
    // A string[] field stored as a plain string is preserved (not silently lost).
    expect(out).toContain('Ideal clients: contractors and nonprofits')
    expect(out).toContain('Emphasize / prioritize: nonprofits')
  })

  it('buildBrandVoiceBlock does not throw on non-string brand fields', () => {
    const dirty = base({}, {
      brand: { brandPersonality: ['warm', 'precise'], voiceExample: 99, currentTone: 'friendly', toneAdjectives: [], toneToAvoid: [] },
    } as unknown as Partial<SessionSchema>)
    expect(() => buildBrandVoiceBlock(dirty)).not.toThrow()
  })
})
