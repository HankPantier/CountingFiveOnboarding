import { describe, expect, it } from 'vitest'
import { buildMbpDocument, mbpDocumentToMarkdown, formatFieldValue } from './build-document'
import type { SessionSchema } from '@/types/session-schema'

// Partial fixture — buildMbpDocument reads via optional chaining, so a subset
// of the (large) SessionSchema shape is enough for these tests.
const SCHEMA = {
  business: { name: 'Korbey Lague', tagline: 'Inspired', firmHistory: '' },
  team: [{ name: 'Kelsey', title: 'Partner', certifications: ['CPA'], bio: '', specializations: [] }],
} as unknown as SessionSchema

describe('formatFieldValue', () => {
  it('renders scalars and joins primitive arrays', () => {
    expect(formatFieldValue('Hi')).toBe('Hi')
    expect(formatFieldValue(['a', 'b'])).toBe('a, b')
    expect(formatFieldValue(2026)).toBe('2026')
  })
  it('returns empty string for empty-ish values', () => {
    expect(formatFieldValue('')).toBe('')
    expect(formatFieldValue(null)).toBe('')
    expect(formatFieldValue(undefined)).toBe('')
  })
  it('JSON-stringifies objects', () => {
    expect(formatFieldValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe('buildMbpDocument', () => {
  const doc = buildMbpDocument(SCHEMA)

  it('emits a Business section with filled + empty fields flagged', () => {
    const business = doc.sections.find(s => s.key === 'business')
    expect(business).toBeTruthy()
    const name = business!.fields!.find(f => f.fieldPath === 'business.name')
    const history = business!.fields!.find(f => f.fieldPath === 'business.firmHistory')
    expect(name!.empty).toBe(false)
    expect(name!.value).toBe('Korbey Lague')
    expect(history!.empty).toBe(true)
  })

  it('emits array sections as items with dotted field paths', () => {
    const team = doc.sections.find(s => s.key === 'team')
    expect(team!.items!.length).toBe(1)
    const bio = team!.items![0].fields.find(f => f.fieldPath === 'team.0.bio')
    expect(bio!.empty).toBe(true)
  })

  it('always surfaces editable content-scope fields, even when absent from the schema', () => {
    const business = doc.sections.find(s => s.key === 'business')
    const emphasis = business!.fields!.find(f => f.fieldPath === 'business.contentEmphasis')
    const exclusions = business!.fields!.find(f => f.fieldPath === 'business.contentExclusions')
    // Present with an array default (so the inline editor treats them as a
    // comma list and saves back an array), flagged empty, and clearly labeled.
    expect(emphasis).toBeTruthy()
    expect(Array.isArray(emphasis!.value)).toBe(true)
    expect(emphasis!.empty).toBe(true)
    expect(emphasis!.label).toBe('Content to emphasize')
    expect(exclusions!.label).toBe('Content to exclude')
  })

  it('preserves existing content-scope values', () => {
    const withScope = buildMbpDocument({
      business: { name: 'X', contentExclusions: ['real estate'] },
    } as unknown as SessionSchema)
    const f = withScope.sections
      .find(s => s.key === 'business')!
      .fields!.find(f => f.fieldPath === 'business.contentExclusions')
    expect(f!.value).toEqual(['real estate'])
    expect(f!.empty).toBe(false)
  })

  it('threads per-field provenance from _meta.field_provenance onto document fields', () => {
    const withProv = buildMbpDocument({
      business: { name: 'X', differentiators: 'Deep nonprofit specialization.' },
      niches: [{ name: 'Nonprofits', customerTrigger: 'losing their bookkeeper' }],
      _meta: {
        field_provenance: {
          'business.differentiators': 'confirmed',
          'niches.0.customerTrigger': 'notes',
        },
      },
    } as unknown as SessionSchema)
    const diff = withProv.sections.find(s => s.key === 'business')!.fields!.find(f => f.fieldPath === 'business.differentiators')
    expect(diff!.provenance).toBe('confirmed')
    const trigger = withProv.sections.find(s => s.key === 'niches')!.items![0].fields.find(f => f.fieldPath === 'niches.0.customerTrigger')
    expect(trigger!.provenance).toBe('notes')
    // A field with no provenance entry carries none.
    expect(withProv.sections.find(s => s.key === 'business')!.fields!.find(f => f.fieldPath === 'business.name')!.provenance).toBeUndefined()
  })

  it('omits the Site Map section when no confirmed sitemap is given', () => {
    expect(doc.sections.find(s => s.key === 'site_map')).toBeUndefined()
  })

  it('includes a Site Map section from the confirmed sitemap', () => {
    const withMap = buildMbpDocument(SCHEMA, [
      { url: '/', title: 'Home', status: 'update' },
      { url: '/about', title: 'About', status: 'new', parent: '/' },
    ])
    const map = withMap.sections.find(s => s.key === 'site_map')
    expect(map).toBeTruthy()
    expect(map!.items!.length).toBe(2)
  })
})

describe('buildMbpDocument scaffolding', () => {
  it('leaves an absent section empty without scaffold (default)', () => {
    const reputation = buildMbpDocument(SCHEMA).sections.find(s => s.key === 'reputation')
    expect(reputation!.fields ?? []).toHaveLength(0)
  })

  it('surfaces every known field as an editable blank with { scaffold: true }', () => {
    const reputation = buildMbpDocument(SCHEMA, null, { scaffold: true }).sections.find(
      s => s.key === 'reputation'
    )
    const summary = reputation!.fields!.find(f => f.fieldPath === 'reputation.reviewSummary')
    expect(summary).toBeTruthy()
    expect(summary!.empty).toBe(true)
    const gaps = reputation!.fields!.find(f => f.fieldPath === 'reputation.trustSignalGaps')
    expect(Array.isArray(gaps!.value)).toBe(true)
  })

  it('does not clobber real values when scaffolding', () => {
    const business = buildMbpDocument(SCHEMA, null, { scaffold: true }).sections.find(
      s => s.key === 'business'
    )
    const name = business!.fields!.find(f => f.fieldPath === 'business.name')
    expect(name!.value).toBe('Korbey Lague')
    expect(name!.empty).toBe(false)
  })
})

describe('mbpDocumentToMarkdown', () => {
  it('renders section headings and field bullets', () => {
    const md = mbpDocumentToMarkdown(buildMbpDocument(SCHEMA))
    expect(md).toContain('# Master Business Profile')
    expect(md).toContain('## Business')
    expect(md).toContain('Korbey Lague')
    expect(md).toContain('_(empty)_')
  })
})
