import { describe, expect, it } from 'vitest'
import { normalizePricingPlansConfig } from './pricing-plans-config'
import { DEFAULT_PLANS_CONFIG } from '@/types/pricing-plans'

describe('normalizePricingPlansConfig', () => {
  it('round-trips the default config', () => {
    const out = normalizePricingPlansConfig(DEFAULT_PLANS_CONFIG)
    expect(out.tiers.length).toBe(DEFAULT_PLANS_CONFIG.tiers.length)
    expect(out.tiers.filter(t => t.isMostPopular).length).toBe(1)
  })

  it('falls back to the default on non-object input', () => {
    expect(normalizePricingPlansConfig('nonsense')).toEqual(DEFAULT_PLANS_CONFIG)
    expect(normalizePricingPlansConfig(null)).toEqual(DEFAULT_PLANS_CONFIG)
  })

  it('coerces multiple most-popular tiers down to the first', () => {
    const raw = {
      tiers: [
        { id: 'a', name: 'A', monthlyPrice: 100, annualPrice: 90, isMostPopular: true, features: [], cta: { label: 'Go', url: '/contact' } },
        { id: 'b', name: 'B', monthlyPrice: 200, annualPrice: 180, isMostPopular: true, features: [], cta: { label: 'Go', url: '/contact' } },
        { id: 'c', name: 'C', monthlyPrice: 300, annualPrice: 270, isMostPopular: true, features: [], cta: { label: 'Go', url: '/contact' } },
      ],
    }
    const out = normalizePricingPlansConfig(raw)
    expect(out.tiers.map(t => t.isMostPopular)).toEqual([true, false, false])
  })

  it('fills defaults for omitted top-level fields', () => {
    const out = normalizePricingPlansConfig({ tiers: [] })
    expect(out.currency).toBe('USD')
    expect(out.billing.defaultCadence).toBe('monthly')
    expect(out.billing.annualDiscountPct).toBe(15)
    expect(out.version).toBe(1)
  })

  it('clamps the annual discount to the allowed range', () => {
    const out = normalizePricingPlansConfig({ tiers: [], billing: { annualDiscountPct: 999 } })
    // 999 is out of range → the field falls back rather than persisting an absurd value.
    expect(out.billing.annualDiscountPct).toBeLessThanOrEqual(90)
  })

  it('preserves feature included flags per tier', () => {
    const raw = {
      tiers: [
        {
          id: 'x', name: 'X', monthlyPrice: 100, annualPrice: 90, isMostPopular: false,
          features: [
            { id: 'f1', label: 'Kept', included: true },
            { id: 'f2', label: 'Excluded', included: false },
          ],
          cta: { label: 'Go', url: '/contact' },
        },
      ],
    }
    const out = normalizePricingPlansConfig(raw)
    expect(out.tiers[0].features.map(f => f.included)).toEqual([true, false])
  })
})
