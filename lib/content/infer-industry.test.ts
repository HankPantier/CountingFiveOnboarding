import { describe, expect, it } from 'vitest'
import { inferSessionIndustry } from './infer-industry'
import type { SessionSchema } from '@/types/session-schema'

describe('inferSessionIndustry', () => {
  it('resolves to the base vertical for a CPA firm profile', () => {
    const schema = {
      business: { name: 'Acme CPA' },
      services: [{ name: 'Tax preparation' }],
      niches: [{ name: 'Dentists' }],
    } as SessionSchema
    expect(inferSessionIndustry(schema)).toBe('tax-accounting')
  })

  it('is total — an empty schema still yields a valid industry', () => {
    expect(inferSessionIndustry({} as SessionSchema)).toBe('tax-accounting')
  })
})
