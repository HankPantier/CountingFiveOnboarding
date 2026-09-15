import { describe, it, expect } from 'vitest'
import { individualizeIdea, type BatchIdeaFields } from './blog-batch-targets'
import type { SessionSchema } from '@/types/session-schema'

const idea: BatchIdeaFields = {
  title: 'Year-end tax moves',
  angle: 'Practical steps before December 31.',
  targetKeyword: 'year-end tax planning',
  secondaryKeywords: ['tax deadlines'],
  rationale: 'Timely',
  contentType: 'blog',
  industry: 'tax-accounting',
}

const schema = {
  business: { name: 'Merrimack CPA', serviceAreas: [{ city: 'Tyngsborough', primary: true }] },
  niches: [
    { name: 'General', painPoints: 'x', valueProp: 'y', signal: 'weak' },
    { name: 'Construction Contractors', painPoints: 'x', valueProp: 'y', signal: 'strong' },
  ],
} as unknown as SessionSchema

describe('individualizeIdea', () => {
  it('tailors the angle to the firm dominant niche + primary market', () => {
    const per = individualizeIdea(idea, schema)
    expect(per.angle).toContain('Practical steps before December 31.') // keeps base angle
    expect(per.angle).toContain('Construction Contractors') // strongest-signal niche wins
    expect(per.angle).toContain('Tyngsborough') // primary market
    expect(per.angle).toContain('Merrimack CPA')
  })

  it('adds a niche-qualified secondary keyword without touching the primary', () => {
    const per = individualizeIdea(idea, schema)
    expect(per.secondaryKeywords).toContain('tax deadlines') // original preserved
    expect(per.secondaryKeywords).toContain('year-end tax planning for Construction Contractors')
  })

  it('is a no-op when there is no schema or no usable niche', () => {
    expect(individualizeIdea(idea, undefined)).toEqual({ angle: idea.angle, secondaryKeywords: idea.secondaryKeywords })
    const noNiche = { business: { name: 'X' }, niches: [] } as unknown as SessionSchema
    expect(individualizeIdea(idea, noNiche)).toEqual({ angle: idea.angle, secondaryKeywords: idea.secondaryKeywords })
  })

  it('does not duplicate a niche keyword the primary already contains', () => {
    const nicheInPrimary: BatchIdeaFields = { ...idea, targetKeyword: 'construction contractors tax planning' }
    const per = individualizeIdea(nicheInPrimary, schema)
    expect(per.secondaryKeywords.filter((k) => k.includes('for Construction Contractors'))).toHaveLength(0)
  })
})
