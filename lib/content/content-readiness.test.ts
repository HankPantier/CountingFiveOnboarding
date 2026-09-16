import { describe, it, expect } from 'vitest'
import { assessContentReadiness } from './content-readiness'
import type { SessionSchema } from '@/types/session-schema'

const ready = {
  business: {
    positioningStatement: 'The go-to CPA for construction contractors who need job costing done right.',
    differentiators: 'Deep construction niche focus plus Sage Intacct expertise most local firms lack.',
    serviceScope: 'national',
  },
  brand: { currentTone: 'Direct and practical', toneAdjectives: ['pragmatic'] },
  niches: [
    { name: 'Construction', painPoints: 'Cash-poor from bad job costing', valueProp: 'Job costing that survives an audit' },
  ],
  services: [
    { name: 'Job Costing', description: 'Set up and run job costing so every project shows its real margin.', offerings: [] },
  ],
} as unknown as SessionSchema

describe('assessContentReadiness', () => {
  it('reports ready when the content-critical fields are filled', () => {
    const r = assessContentReadiness(ready)
    expect(r.ready).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('flags an empty positioning + differentiators', () => {
    const r = assessContentReadiness({ ...ready, business: {} } as unknown as SessionSchema)
    expect(r.ready).toBe(false)
    expect(r.missing.some((m) => m.includes('Positioning'))).toBe(true)
    expect(r.missing.some((m) => m.includes('Differentiators'))).toBe(true)
  })

  it('flags missing brand voice', () => {
    const r = assessContentReadiness({ ...ready, brand: {} } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('Brand voice'))).toBe(true)
  })

  it('flags when no niche has both pain points and value prop', () => {
    const r = assessContentReadiness({
      ...ready,
      niches: [{ name: 'Construction', painPoints: '', valueProp: '' }],
    } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('niche'))).toBe(true)
  })

  it('treats a placeholder-thin differentiators value as missing', () => {
    const r = assessContentReadiness({
      ...ready,
      business: { ...ready.business, differentiators: 'good' },
    } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('Differentiators'))).toBe(true)
  })

  it('flags when no active service has a name + description', () => {
    const r = assessContentReadiness({
      ...ready,
      services: [{ name: 'Job Costing', description: '', offerings: [] }],
    } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('service'))).toBe(true)
  })

  it('ignores a dropped service when checking service readiness', () => {
    const r = assessContentReadiness({
      ...ready,
      services: [
        { name: 'Job Costing', description: 'Full job costing setup and monthly review.', offerings: [], status: 'dropped' },
      ],
    } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('service'))).toBe(true)
  })

  it('flags a missing geographic decision', () => {
    const r = assessContentReadiness({
      ...ready,
      business: { ...ready.business, serviceScope: undefined, geographicScope: '' },
    } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('geographic'))).toBe(true)
  })

  it('accepts a service area as a geographic decision', () => {
    const r = assessContentReadiness({
      ...ready,
      business: { ...ready.business, serviceScope: undefined, serviceAreas: [{ city: 'Nashua', state: 'NH' }] },
    } as unknown as SessionSchema)
    expect(r.missing.some((m) => m.includes('geographic'))).toBe(false)
  })
})
