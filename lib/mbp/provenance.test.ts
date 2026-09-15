import { describe, expect, it } from 'vitest'
import { assessThinness, stampProvenance, provenanceOf } from './provenance'
import type { SessionSchema } from '@/types/session-schema'

describe('assessThinness', () => {
  it('flags a too-short prose value as thin', () => {
    expect(assessThinness('brand.voiceExample', 'we are good')).toBe(true)
    expect(assessThinness('niches[0].customerTrigger', 'taxes')).toBe(true)
  })

  it('passes a substantive prose value', () => {
    expect(assessThinness('brand.voiceExample', 'We write like a trusted friend who happens to know tax law cold.')).toBe(false)
  })

  it('never flags untracked fields, arrays, or non-strings', () => {
    expect(assessThinness('business.tagline', 'x')).toBe(false) // not tracked
    expect(assessThinness('brand.voiceExample', ['a', 'b'])).toBe(false)
    expect(assessThinness('brand.voiceExample', 42)).toBe(false)
  })
})

describe('stampProvenance', () => {
  it('tags filled paths with the source and normalizes bracket paths', () => {
    const schema = {
      business: { differentiators: 'Deep nonprofit specialization since 1998.' },
      niches: [{ name: 'Nonprofits', customerTrigger: 'losing their grant-funded bookkeeper' }],
    } as SessionSchema
    const out = stampProvenance(schema, ['business.differentiators', 'niches[0].customerTrigger'], 'confirmed')
    expect(out._meta?.field_provenance).toEqual({
      'business.differentiators': 'confirmed',
      'niches.0.customerTrigger': 'confirmed',
    })
    // provenanceOf accepts either path form.
    expect(provenanceOf(out, 'niches[0].customerTrigger')).toBe('confirmed')
    expect(provenanceOf(out, 'niches.0.customerTrigger')).toBe('confirmed')
  })

  it('downgrades a filled-but-thin value to thin regardless of source', () => {
    const schema = { brand: { voiceExample: 'nice' } } as SessionSchema
    const out = stampProvenance(schema, ['brand.voiceExample'], 'notes')
    expect(provenanceOf(out, 'brand.voiceExample')).toBe('thin')
  })

  it('never stamps an empty path and returns the same schema when nothing changes', () => {
    const schema = { brand: { voiceExample: '' } } as SessionSchema
    const out = stampProvenance(schema, ['brand.voiceExample'], 'confirmed')
    expect(out).toBe(schema)
    expect(provenanceOf(out, 'brand.voiceExample')).toBeUndefined()
  })

  it('merges into existing provenance without dropping prior tags', () => {
    const schema = {
      _meta: { field_provenance: { 'business.foundingYear': 'audit' } },
      business: { foundingYear: '1998', differentiators: 'Deep nonprofit specialization since 1998.' },
    } as unknown as SessionSchema
    const out = stampProvenance(schema, ['business.differentiators'], 'notes')
    expect(out._meta?.field_provenance).toEqual({
      'business.foundingYear': 'audit',
      'business.differentiators': 'notes',
    })
  })
})
