import { describe, expect, it } from 'vitest'
import { asIndustry, isIndustry, DEFAULT_INDUSTRY, INDUSTRY_OPTIONS } from './industries'

describe('industries', () => {
  it('recognizes known industry slugs', () => {
    expect(isIndustry('tax-accounting')).toBe(true)
    expect(isIndustry('legal')).toBe(false)
    expect(isIndustry(42)).toBe(false)
    expect(isIndustry(undefined)).toBe(false)
  })

  it('coerces unknown/empty values to the default vertical', () => {
    expect(asIndustry('tax-accounting')).toBe('tax-accounting')
    expect(asIndustry('nonsense')).toBe(DEFAULT_INDUSTRY)
    expect(asIndustry(null)).toBe(DEFAULT_INDUSTRY)
    expect(asIndustry(undefined)).toBe(DEFAULT_INDUSTRY)
  })

  it('exposes selector options for every known industry', () => {
    expect(INDUSTRY_OPTIONS.length).toBeGreaterThan(0)
    for (const opt of INDUSTRY_OPTIONS) {
      expect(isIndustry(opt.value)).toBe(true)
      expect(opt.label.length).toBeGreaterThan(0)
    }
  })
})
