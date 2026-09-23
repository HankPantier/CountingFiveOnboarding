import { describe, expect, it } from 'vitest'
import { applySubCategoryReview } from './subcategory-review'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

type Sub = NonNullable<NonNullable<SessionSchema['niches']>[number]['subCategories']>[number]

const niche = (
  name: string,
  subCategories: Sub[],
  status?: 'kept' | 'dropped',
) => ({ name, description: '', icp: '', painPoints: '', valueProp: '', subCategories, ...(status ? { status } : {}) })

const baseSchema = (): SessionSchema =>
  ({
    business: { name: 'Acme', contentExclusions: [] } as unknown as SessionSchema['business'],
    niches: [
      niche('Dental', [
        { name: 'Implants', status: 'likely' },
        { name: 'Orthodontics', status: 'verify' },
      ]),
      niche('Legal', [{ name: 'Estate Planning', status: 'confirmed' }]),
    ],
  } as SessionSchema)

const gaps = (): GapItem[] => [
  { field: 'niches[0].painPoints', label: 'Dental — Pain', phase: 4, tier: 1, resolved: false },
]

const AT = '2026-09-17T00:00:00.000Z'
const sub = (niche: string, name: string) => ({ niche, name })

describe('applySubCategoryReview', () => {
  it('sets dropped/confirmed status per niche-scoped decision', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(),
      gaps(),
      { confirm: [sub('Dental', 'Implants')], drop: [sub('Dental', 'Orthodontics')] },
      AT,
    )
    const dental = schema.niches?.find(n => n.name === 'Dental')
    expect(dental?.subCategories?.map(s => [s.name, s.status])).toEqual([
      ['Implants', 'confirmed'],
      ['Orthodontics', 'dropped'],
    ])
  })

  it('matches niche + sub name case-insensitively', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(),
      gaps(),
      { drop: [sub('dental', 'orthodontics')] },
      AT,
    )
    const dental = schema.niches?.find(n => n.name === 'Dental')
    expect(dental?.subCategories?.find(s => s.name === 'Orthodontics')?.status).toBe('dropped')
  })

  it('leaves an untouched sub-service at its seeded status', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(),
      gaps(),
      { drop: [sub('Dental', 'Orthodontics')] },
      AT,
    )
    const dental = schema.niches?.find(n => n.name === 'Dental')
    expect(dental?.subCategories?.find(s => s.name === 'Implants')?.status).toBe('likely')
  })

  it('ignores sub-services under a dropped niche', () => {
    const schema0 = baseSchema()
    schema0.niches![1].status = 'dropped'
    const { schema } = applySubCategoryReview(
      schema0,
      gaps(),
      { drop: [sub('Legal', 'Estate Planning')] },
      AT,
    )
    const legal = schema.niches?.find(n => n.name === 'Legal')
    expect(legal?.subCategories?.[0].status).toBe('confirmed')
    expect(schema._meta?.subcategories_review?.dropped).toEqual([])
  })

  it('does NOT mirror niche-scoped sub-service names into the firm-wide contentExclusions', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(),
      gaps(),
      { drop: [sub('Dental', 'Orthodontics')] },
      AT,
    )
    expect(schema.business?.contentExclusions).toEqual([])
  })

  it('records the review with confirmed/dropped pairs + reviewedBy', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(),
      gaps(),
      { confirm: [sub('Dental', 'Implants')], drop: [sub('Dental', 'Orthodontics')] },
      AT,
      'user-1',
    )
    expect(schema._meta?.subcategories_review).toEqual({
      reviewedAt: AT,
      confirmed: [{ niche: 'Dental', name: 'Implants' }],
      dropped: [{ niche: 'Dental', name: 'Orthodontics' }],
      reviewedBy: 'user-1',
    })
  })

  it('does not mutate its inputs, passes gaps through, and is idempotent', () => {
    const schema = baseSchema()
    const g = gaps()
    const first = applySubCategoryReview(schema, g, { drop: [sub('Dental', 'Orthodontics')] }, AT)
    // inputs untouched
    expect(schema.niches?.[0].subCategories?.[1].status).toBe('verify')
    expect(first.gaps).toEqual(g)
    expect(first.gaps).not.toBe(g)
    // re-applying the same review over the result is a no-op beyond timestamp
    const second = applySubCategoryReview(first.schema, first.gaps, { drop: [sub('Dental', 'Orthodontics')] }, AT)
    expect(second.schema.niches).toEqual(first.schema.niches)
    expect(second.schema.business?.contentExclusions).toEqual([])
  })

  it('promotes a sub-service to its own page and folds exclude into drop', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(), gaps(),
      { treatments: [
        { niche: 'Dental', name: 'Implants', pageTreatment: 'page', origin: 'site' },
        { niche: 'Dental', name: 'Orthodontics', pageTreatment: 'exclude' },
      ] },
      AT,
    )
    const dental = schema.niches?.find(n => n.name === 'Dental')
    const implants = dental?.subCategories?.find(s => s.name === 'Implants')
    const ortho = dental?.subCategories?.find(s => s.name === 'Orthodontics')
    expect(implants).toMatchObject({ status: 'confirmed', pageTreatment: 'page' })
    expect(ortho?.status).toBe('dropped')
    expect(schema._meta?.subcategories_review?.confirmed).toEqual([{ niche: 'Dental', name: 'Implants' }])
    expect(schema._meta?.subcategories_review?.dropped).toEqual([{ niche: 'Dental', name: 'Orthodontics' }])
  })

  it('appends an audit-proposed sub-service not already present under its niche', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(), gaps(),
      { treatments: [{ niche: 'Legal', name: 'Trust Administration', pageTreatment: 'block', parent: '/industries/legal', origin: 'audit' }] },
      AT,
    )
    const legal = schema.niches?.find((n) => n.name === 'Legal')
    expect(legal?.subCategories?.find((s) => s.name === 'Trust Administration')).toMatchObject({
      status: 'confirmed', origin: 'audit', pageTreatment: 'block', parent: '/industries/legal',
    })
    expect(schema._meta?.subcategories_review?.confirmed).toContainEqual({ niche: 'Legal', name: 'Trust Administration' })
  })

  it('never appends an excluded proposed sub-service', () => {
    const { schema } = applySubCategoryReview(
      baseSchema(), gaps(),
      { treatments: [{ niche: 'Legal', name: 'Nope', pageTreatment: 'exclude' }] },
      AT,
    )
    expect(schema.niches?.find((n) => n.name === 'Legal')?.subCategories?.some((s) => s.name === 'Nope')).toBe(false)
  })
})
