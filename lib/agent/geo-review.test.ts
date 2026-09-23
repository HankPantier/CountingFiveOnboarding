import { describe, expect, it } from 'vitest'
import { applyGeoReview } from './geo-review'
import type { SessionSchema } from '@/types/session-schema'

const baseSchema = (): SessionSchema =>
  ({ business: { name: 'Acme' } as unknown as SessionSchema['business'] } as SessionSchema)

const AT = '2026-09-16T00:00:00.000Z'

describe('applyGeoReview', () => {
  it('sets scope + confirmed areas with a single primary', () => {
    const schema = applyGeoReview(
      baseSchema(),
      { scope: 'regional', areas: [{ city: 'Nashua', state: 'NH' }, { city: 'Manchester', state: 'NH', primary: true }] },
      AT,
    )
    expect(schema.business?.serviceScope).toBe('regional')
    expect(schema.business?.serviceAreas).toEqual([
      { city: 'Nashua', state: 'NH' },
      { city: 'Manchester', state: 'NH', primary: true },
    ])
    expect(schema._meta?.geo_review).toEqual({ reviewedAt: AT, scope: 'regional', areaCount: 2 })
  })

  it('defaults the first area to primary when none is flagged', () => {
    const schema = applyGeoReview(
      baseSchema(),
      { scope: 'local', areas: [{ city: 'Nashua' }, { city: 'Merrimack' }] },
      AT,
    )
    expect(schema.business?.serviceAreas?.[0].primary).toBe(true)
    expect(schema.business?.serviceAreas?.[1].primary).toBeUndefined()
  })

  it('clears service areas for a national scope and records areaCount 0', () => {
    const schema = applyGeoReview(
      baseSchema(),
      { scope: 'national', areas: [{ city: 'Nashua' }] },
      AT,
    )
    expect(schema.business?.serviceAreas).toEqual([])
    expect(schema.business?.serviceScope).toBe('national')
    expect(schema._meta?.geo_review?.areaCount).toBe(0)
    expect(schema.business?.geographicScope).toBe('Works nationally')
  })

  it('dedups areas by city+state and drops blank cities', () => {
    const schema = applyGeoReview(
      baseSchema(),
      { scope: 'local', areas: [{ city: 'Nashua', state: 'NH' }, { city: 'nashua', state: 'nh' }, { city: '  ' }] },
      AT,
    )
    expect(schema.business?.serviceAreas).toHaveLength(1)
  })

  it('does not mutate its input and records reviewedBy', () => {
    const schema = baseSchema()
    const out = applyGeoReview(schema, { scope: 'national' }, AT, 'user-1')
    expect(schema.business?.serviceScope).toBeUndefined()
    expect(out._meta?.geo_review?.reviewedBy).toBe('user-1')
  })

  it('synthesizes a geographicScope from the primary market when absent', () => {
    const schema = applyGeoReview(
      baseSchema(),
      { scope: 'local', areas: [{ city: 'Nashua', state: 'NH', primary: true }] },
      AT,
    )
    expect(schema.business?.geographicScope).toContain('Nashua')
  })
})

describe('applyGeoReview — primary after dedup', () => {
  it('keeps the operator-picked primary when duplicates/blank rows precede it', () => {
    const out = applyGeoReview(
      { business: { name: 'A' } } as unknown as SessionSchema,
      {
        scope: 'local',
        areas: [
          { city: 'Austin', state: 'TX' },
          { city: 'austin', state: 'tx' },
          { city: '' },
          { city: 'Dallas', state: 'TX', primary: true },
        ],
      },
      '2026-09-22T00:00:00.000Z',
    )
    const areas = out.business?.serviceAreas ?? []
    expect(areas.map((a) => a.city)).toEqual(['Austin', 'Dallas'])
    expect(areas.find((a) => a.primary)?.city).toBe('Dallas')
    expect(areas.filter((a) => a.primary)).toHaveLength(1)
  })
})
