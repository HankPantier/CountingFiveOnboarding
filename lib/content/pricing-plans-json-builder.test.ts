import { describe, expect, it } from 'vitest'
import {
  buildPricingPlansPageMd,
  pricingPlansJsonEntry,
  PRICING_PLANS_JSON_PATH,
  PRICING_PLANS_URL,
} from './pricing-plans-json-builder'
import { DEFAULT_PLANS_CONFIG } from '@/types/pricing-plans'

describe('buildPricingPlansPageMd', () => {
  it('emits a minimal host page with the pricing-plans annotation', () => {
    const md = buildPricingPlansPageMd('Acme CPA', DEFAULT_PLANS_CONFIG)
    expect(md).toContain(`url: ${PRICING_PLANS_URL}`)
    expect(md).toContain('title: Pricing | Acme CPA')
    expect(md).toContain('<!-- block: pricing-plans -->')
    expect(md).toContain('## Plans & pricing')
    expect(md).toContain(DEFAULT_PLANS_CONFIG.intro)
  })

  it('tolerates a blank firm name', () => {
    const md = buildPricingPlansPageMd('', DEFAULT_PLANS_CONFIG)
    expect(md).toContain('title: Pricing | our firm')
  })
})

describe('pricingPlansJsonEntry', () => {
  it('serializes the config to the canonical path', () => {
    const entry = pricingPlansJsonEntry(DEFAULT_PLANS_CONFIG)
    expect(entry.path).toBe(PRICING_PLANS_JSON_PATH)
    expect(JSON.parse(entry.content)).toEqual(DEFAULT_PLANS_CONFIG)
  })
})
