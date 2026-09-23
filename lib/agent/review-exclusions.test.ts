import { describe, expect, it } from 'vitest'
import type { SessionSchema } from '@/types/session-schema'
import { applyNicheReview } from './niche-review'
import { applyServiceReview } from './service-review'
import { syncReviewExclusions } from './review-exclusions'

const AT = '2026-09-22T00:00:00.000Z'

const base = (exclusions: unknown = ['Crypto']): SessionSchema =>
  ({
    business: { name: 'Acme', contentExclusions: exclusions },
    niches: [{ name: 'Legal' }, { name: 'Dental' }],
    services: [{ name: 'Payroll' }, { name: 'Tax Prep' }],
  }) as unknown as SessionSchema

describe('syncReviewExclusions via the review helpers', () => {
  it('removes a review-added exclusion when the item is later kept', () => {
    const first = applyNicheReview(base(), [], { drop: ['Legal'] }, AT)
    expect(first.schema.business?.contentExclusions).toEqual(['Crypto', 'Legal'])
    expect(first.schema._meta?.review_exclusions).toEqual(['Legal'])

    const second = applyNicheReview(first.schema, [], { keep: ['Legal'] }, AT)
    expect(second.schema.business?.contentExclusions).toEqual(['Crypto'])
    expect(second.schema._meta?.review_exclusions).toEqual([])
  })

  it('never removes an operator-typed exclusion that matches a re-kept item', () => {
    const first = applyNicheReview(base(['Legal']), [], { drop: ['Legal'] }, AT)
    expect(first.schema.business?.contentExclusions).toEqual(['Legal'])
    const second = applyNicheReview(first.schema, [], { keep: ['Legal'] }, AT)
    expect(second.schema.business?.contentExclusions).toEqual(['Legal'])
  })

  it('a niche review does not retract a service-review exclusion', () => {
    const s1 = applyServiceReview(base([]), [], { drop: ['Payroll'] }, AT)
    const s2 = applyNicheReview(s1.schema, [], { drop: ['Dental'] }, AT)
    expect(s2.schema.business?.contentExclusions).toEqual(['Payroll', 'Dental'])
    const s3 = applyServiceReview(s2.schema, [], { keep: ['Payroll'] }, AT)
    expect(s3.schema.business?.contentExclusions).toEqual(['Dental'])
  })

  it('tolerates a stringy stored contentExclusions (no crash, value kept)', () => {
    const out = applyNicheReview(base('Crypto'), [], { drop: ['Legal'] }, AT)
    expect(out.schema.business?.contentExclusions).toEqual(['Crypto', 'Legal'])
    const svc = applyServiceReview(base('Crypto'), [], { drop: ['Payroll'] }, AT)
    expect(svc.schema.business?.contentExclusions).toEqual(['Crypto', 'Payroll'])
  })

  it('is a no-op without a business object', () => {
    const s = { niches: [{ name: 'X', status: 'dropped' }] } as unknown as SessionSchema
    syncReviewExclusions(s)
    expect(s.business).toBeUndefined()
  })
})

describe('partial resubmit semantics', () => {
  it('an item missing from a resubmit keeps its earlier dropped status', () => {
    const first = applyNicheReview(base([]), [], { drop: ['Legal'] }, AT)
    const second = applyNicheReview(first.schema, [], { treatments: [{ name: 'Dental', pageTreatment: 'page' }] }, AT)
    expect(second.schema.niches?.find((n) => n.name === 'Legal')?.status).toBe('dropped')
    expect(second.schema.niches?.find((n) => n.name === 'Dental')?.status).toBe('kept')
    expect(second.schema._meta?.niche_review?.dropped).toEqual(['Legal'])
    const svc1 = applyServiceReview(base([]), [], { drop: ['Payroll'] }, AT)
    const svc2 = applyServiceReview(svc1.schema, [], {}, AT)
    expect(svc2.schema.services?.find((s) => s.name === 'Payroll')?.status).toBe('dropped')
  })
})
