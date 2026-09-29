import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn().mockResolvedValue(null) }))

import { generateMbpJson } from '@/lib/mbp/generate-json'
import { coerceSuggestions, suggestAuditTreatments } from './suggest-audit-treatments'
import type { SessionSchema } from '@/types/session-schema'

const ctx = { serviceNames: ['Bookkeeping', 'Business Tax'], nicheNames: ['Dental'] }
const AT = '2026-09-18T00:00:00.000Z'

describe('coerceSuggestions', () => {
  it('coerces valid entries and resolves a block parent to a sibling URL', () => {
    const out = coerceSuggestions(
      {
        services: [
          { name: 'Bookkeeping', treatment: 'page', rationale: 'Core service.', confidence: 'high' },
          { name: 'Audit Protection', treatment: 'block', parent: 'Business Tax', rationale: 'Thin standalone.', confidence: 'medium' },
        ],
        niches: [{ name: 'Dental', treatment: 'page', rationale: 'Strong signal.' }],
        subCategories: [{ niche: 'Dental', name: 'Implants', treatment: 'block', rationale: 'A section.' }],
        team: [{ name: 'Ann', decision: 'keep', rationale: 'Active.' }],
        geoScope: { scope: 'local', primaryArea: 'Nashua', rationale: 'Local firm.' },
      },
      ctx,
      AT,
    )!
    expect(out.services).toEqual([
      { name: 'Bookkeeping', treatment: 'page', rationale: 'Core service.', confidence: 'high' },
      { name: 'Audit Protection', treatment: 'block', parent: '/services/business-tax', rationale: 'Thin standalone.', confidence: 'medium' },
    ])
    expect(out.niches?.[0]).toMatchObject({ name: 'Dental', treatment: 'page' })
    expect(out.subCategories).toEqual([{ niche: 'Dental', name: 'Implants', treatment: 'block', rationale: 'A section.' }])
    expect(out.team).toEqual([{ name: 'Ann', decision: 'keep', rationale: 'Active.' }])
    expect(out.geoScope).toEqual({ scope: 'local', primaryArea: 'Nashua', rationale: 'Local firm.' })
    expect(out.generatedAt).toBe(AT)
  })

  it('drops entries missing a name, a valid enum, or a rationale (keeps exclude evidence)', () => {
    const out = coerceSuggestions(
      {
        services: [
          { name: '', treatment: 'page', rationale: 'x' },
          { name: 'A', treatment: 'bogus', rationale: 'x' },
          { name: 'B', treatment: 'page', rationale: '' },
          { name: 'C', treatment: 'exclude', rationale: 'No content found on the current site.' },
        ],
      },
      ctx,
      AT,
    )
    expect(out?.services).toEqual([{ name: 'C', treatment: 'exclude', rationale: 'No content found on the current site.' }])
  })

  it('defaults an unknown or blank block parent to the category hub', () => {
    const out = coerceSuggestions({ services: [{ name: 'X', treatment: 'block', parent: 'Nonexistent', rationale: 'r' }] }, ctx, AT)
    expect(out?.services?.[0].parent).toBe('/services')
  })

  it('returns null when nothing usable survives', () => {
    expect(coerceSuggestions({}, ctx, AT)).toBeNull()
    expect(coerceSuggestions(null, ctx, AT)).toBeNull()
    expect(coerceSuggestions({ services: [{ name: 'A', treatment: 'bad', rationale: '' }] }, ctx, AT)).toBeNull()
  })
})

describe('suggestAuditTreatments', () => {
  it('forwards the caller timeout to the generation call', async () => {
    const schema = { services: [{ name: 'Bookkeeping' }] } as SessionSchema
    await suggestAuditTreatments(schema, undefined, { auditId: 'a1', timeoutMs: 42_000 })
    expect(vi.mocked(generateMbpJson).mock.calls[0][4]).toMatchObject({ timeoutMs: 42_000 })
  })
})
