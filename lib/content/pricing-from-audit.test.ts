import { describe, expect, it } from 'vitest'
import { parsePriceNumber, buildPlansConfigFromAudit, buildCalculatorConfigFromAudit } from './pricing-from-audit'
import type { SessionSchema } from '@/types/session-schema'

function schemaWithPricing(pricing: NonNullable<NonNullable<SessionSchema['_meta']>['audit_context']>['pricing']): SessionSchema {
  return { _meta: { phase3_completed_chunks: [], phase4_resolved_tiers: { tier1_done: false, tier2_done: false }, phase4_flagged_for_followup: [], admin_overrides: {}, audit_context: { pricing } } }
}

describe('parsePriceNumber', () => {
  it('parses currency-prefixed figures with commas and periods', () => {
    expect(parsePriceNumber('$1,500/mo')).toBe(1500)
    expect(parsePriceNumber('$299/month')).toBe(299)
    expect(parsePriceNumber('Starting at $99')).toBe(99)
  })
  it('understands a trailing k', () => {
    expect(parsePriceNumber('$1.5k')).toBe(1500)
  })
  it('returns null for quote-only / empty labels', () => {
    expect(parsePriceNumber('Custom')).toBeNull()
    expect(parsePriceNumber('')).toBeNull()
    expect(parsePriceNumber(undefined)).toBeNull()
  })
})

describe('buildPlansConfigFromAudit', () => {
  it('returns null when no tiers were captured', () => {
    expect(buildPlansConfigFromAudit({})).toBeNull()
    expect(buildPlansConfigFromAudit(schemaWithPricing({ rates: [{ service: 'x', rate: '$1' }] }))).toBeNull()
  })

  it('maps captured tiers to base plan tiers with parsed prices', () => {
    const cfg = buildPlansConfigFromAudit(
      schemaWithPricing({
        strategy: 'tiers',
        tiers: [
          { name: 'Basic', price: '$300/mo', features: ['Bookkeeping'] },
          { name: 'Pro', price: '$600/mo', features: ['Bookkeeping', 'Advisory'] },
          { name: 'Enterprise', price: 'Custom', features: ['Everything'] },
        ],
      })
    )!
    expect(cfg.tiers.map(t => t.name)).toEqual(['Basic', 'Pro', 'Enterprise'])
    expect(cfg.tiers[0].monthlyPrice).toBe(300)
    expect(cfg.tiers[0].annualPrice).toBe(255) // 300 * (1 - 0.15)
    // The quote-only tier keeps its label as the suffix and no numeric price.
    expect(cfg.tiers[2].monthlyPrice).toBe(0)
    expect(cfg.tiers[2].priceSuffix).toBe('Custom')
    // Middle tier flagged most-popular; only one.
    expect(cfg.tiers.filter(t => t.isMostPopular).length).toBe(1)
    expect(cfg.tiers[1].isMostPopular).toBe(true)
    // No invented add-ons / shared numbers.
    expect(cfg.addOns).toEqual([])
    expect(cfg.sharedFeatures.items).toEqual([])
  })
})

describe('buildCalculatorConfigFromAudit', () => {
  it('returns null when no rates were captured', () => {
    expect(buildCalculatorConfigFromAudit({})).toBeNull()
    expect(buildCalculatorConfigFromAudit(schemaWithPricing({ tiers: [{ name: 'A' }] }))).toBeNull()
  })

  it('maps captured per-service rates to service lines and drops placeholder fees', () => {
    const cfg = buildCalculatorConfigFromAudit(
      schemaWithPricing({ rates: [{ service: 'Bookkeeping', rate: '$250/mo' }, { service: 'Payroll', rate: '$99' }] })
    )!
    expect(cfg.serviceLines.map(s => [s.label, s.baseRate])).toEqual([['Bookkeeping', 250], ['Payroll', 99]])
    expect(cfg.implementationFee).toBeNull()
    expect(cfg.addOns).toEqual([])
  })
})
