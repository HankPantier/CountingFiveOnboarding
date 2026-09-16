import { describe, expect, it } from 'vitest'
import { applyServiceReview } from './service-review'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

const service = (name: string) => ({ name, description: '', offerings: [] as string[] })

const baseSchema = (): SessionSchema =>
  ({
    business: { name: 'Acme', contentExclusions: [] } as unknown as SessionSchema['business'],
    services: [service('Bookkeeping'), service('Tax Prep'), service('Payroll')],
  } as SessionSchema)

const gaps = (): GapItem[] => [
  { field: 'business.foundingYear', label: 'Founding Year', phase: 4, tier: 1, resolved: false },
  { field: 'services[0].description', label: 'Bookkeeping — Desc', phase: 4, tier: 1, resolved: false },
  { field: 'services[1].description', label: 'Tax Prep — Desc', phase: 4, tier: 1, resolved: false },
]

const AT = '2026-09-16T00:00:00.000Z'

describe('applyServiceReview', () => {
  it('marks dropped/kept status and preserves services[i] indexes', () => {
    const { schema } = applyServiceReview(baseSchema(), gaps(), { drop: ['Tax Prep'] }, AT)
    expect(schema.services?.map(s => [s.name, s.status])).toEqual([
      ['Bookkeeping', 'kept'],
      ['Tax Prep', 'dropped'],
      ['Payroll', 'kept'],
    ])
  })

  it('prunes only the dropped service gaps, keeps others by original index', () => {
    const { gaps: out } = applyServiceReview(baseSchema(), gaps(), { drop: ['Tax Prep'] }, AT)
    expect(out.map(g => g.field)).toEqual(['business.foundingYear', 'services[0].description'])
  })

  it('mirrors dropped names into contentExclusions (dedup)', () => {
    const { schema } = applyServiceReview(baseSchema(), gaps(), { drop: ['Tax Prep', 'Payroll'] }, AT)
    expect(schema.business?.contentExclusions).toEqual(['Tax Prep', 'Payroll'])
  })

  it('adds net-new services and skips ones already present (case-insensitive)', () => {
    const { schema } = applyServiceReview(baseSchema(), gaps(), { add: ['Fractional CFO', 'bookkeeping'] }, AT)
    const names = schema.services?.map(s => s.name)
    expect(names).toContain('Fractional CFO')
    expect(names?.filter(n => n.toLowerCase() === 'bookkeeping')).toHaveLength(1)
    expect(schema._meta?.services_review?.added).toEqual(['Fractional CFO'])
  })

  it('records the review with kept/dropped/added + reviewedBy', () => {
    const { schema } = applyServiceReview(
      baseSchema(), gaps(), { drop: ['Tax Prep'], add: ['Fractional CFO'] }, AT, 'user-1',
    )
    expect(schema._meta?.services_review).toEqual({
      reviewedAt: AT,
      kept: ['Bookkeeping', 'Payroll', 'Fractional CFO'],
      dropped: ['Tax Prep'],
      added: ['Fractional CFO'],
      reviewedBy: 'user-1',
    })
  })

  it('does not mutate its inputs and is idempotent', () => {
    const schema = baseSchema()
    const g = gaps()
    const first = applyServiceReview(schema, g, { drop: ['Tax Prep'] }, AT)
    expect(schema.services?.[1].status).toBeUndefined()
    expect(g).toHaveLength(3)
    const second = applyServiceReview(first.schema, first.gaps, { drop: ['Tax Prep'] }, AT)
    expect(second.schema.services).toEqual(first.schema.services)
    expect(second.schema.business?.contentExclusions).toEqual(['Tax Prep'])
    expect(second.gaps).toEqual(first.gaps)
  })
})
