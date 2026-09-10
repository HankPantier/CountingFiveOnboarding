import { describe, expect, it } from 'vitest'
import { applyNicheReview } from './niche-review'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

const niche = (name: string) => ({ name, description: '', icp: '', painPoints: '', valueProp: '' })

const baseSchema = (): SessionSchema =>
  ({
    business: { name: 'Acme', contentExclusions: [] } as unknown as SessionSchema['business'],
    niches: [niche('Dental'), niche('Legal'), niche('Nonprofit')],
  } as SessionSchema)

const gaps = (): GapItem[] => [
  { field: 'business.foundingYear', label: 'Founding Year', phase: 4, tier: 1, resolved: false },
  { field: 'niches[0].painPoints', label: 'Dental — Pain', phase: 4, tier: 1, resolved: false },
  { field: 'niches[1].painPoints', label: 'Legal — Pain', phase: 4, tier: 1, resolved: false },
]

const AT = '2026-09-10T00:00:00.000Z'

describe('applyNicheReview', () => {
  it('marks dropped/kept status and preserves niches[i] indexes', () => {
    const { schema } = applyNicheReview(baseSchema(), gaps(), { drop: ['Legal'] }, AT)
    expect(schema.niches?.map(n => [n.name, n.status])).toEqual([
      ['Dental', 'kept'],
      ['Legal', 'dropped'],
      ['Nonprofit', 'kept'],
    ])
  })

  it('prunes only the dropped niche gaps, keeps others by original index', () => {
    const { gaps: out } = applyNicheReview(baseSchema(), gaps(), { drop: ['Legal'] }, AT)
    expect(out.map(g => g.field)).toEqual(['business.foundingYear', 'niches[0].painPoints'])
  })

  it('mirrors dropped names into contentExclusions (dedup)', () => {
    const { schema } = applyNicheReview(baseSchema(), gaps(), { drop: ['Legal', 'Nonprofit'] }, AT)
    expect(schema.business?.contentExclusions).toEqual(['Legal', 'Nonprofit'])
  })

  it('adds net-new niches and skips ones already present (case-insensitive)', () => {
    const { schema } = applyNicheReview(baseSchema(), gaps(), { add: ['Construction', 'dental'] }, AT)
    const names = schema.niches?.map(n => n.name)
    expect(names).toContain('Construction')
    expect(names?.filter(n => n.toLowerCase() === 'dental')).toHaveLength(1)
    expect(schema._meta?.niche_review?.added).toEqual(['Construction'])
  })

  it('records the review with kept/dropped/added + reviewedBy', () => {
    const { schema } = applyNicheReview(
      baseSchema(), gaps(), { drop: ['Legal'], add: ['Construction'] }, AT, 'user-1',
    )
    expect(schema._meta?.niche_review).toEqual({
      reviewedAt: AT,
      kept: ['Dental', 'Nonprofit', 'Construction'],
      dropped: ['Legal'],
      added: ['Construction'],
      reviewedBy: 'user-1',
    })
  })

  it('does not mutate its inputs and is idempotent', () => {
    const schema = baseSchema()
    const g = gaps()
    const first = applyNicheReview(schema, g, { drop: ['Legal'] }, AT)
    // inputs untouched
    expect(schema.niches?.[1].status).toBeUndefined()
    expect(g).toHaveLength(3)
    // re-applying the same review over the result is a no-op beyond timestamp
    const second = applyNicheReview(first.schema, first.gaps, { drop: ['Legal'] }, AT)
    expect(second.schema.niches).toEqual(first.schema.niches)
    expect(second.schema.business?.contentExclusions).toEqual(['Legal'])
    expect(second.gaps).toEqual(first.gaps)
  })
})
