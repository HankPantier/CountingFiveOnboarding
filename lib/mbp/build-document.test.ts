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

describe('mbpDocumentToMarkdown', () => {
  it('renders section headings and field bullets', () => {
    const md = mbpDocumentToMarkdown(buildMbpDocument(SCHEMA))
    expect(md).toContain('# Master Business Profile')
    expect(md).toContain('## Business')
    expect(md).toContain('Korbey Lague')
    expect(md).toContain('_(empty)_')
  })
})
