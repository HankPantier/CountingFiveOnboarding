import { describe, it, expect } from 'vitest'
import { runRules, type RulesInput } from './index'

const base: RulesInput = {
  body: '<!-- block: content-split | variant: image-right -->\n## A\n\nText.\n',
  metaTitle: 'Tax Planning for Dental Practices in Austin | Firm Name',  // 55 chars
  metaDescription: 'x'.repeat(155),
  heroBlock: 'hero', heroVariant: 'image', heroSubhead: null, faqBlock: null,
  noGoPhrases: [], avoidPhrases: [],
}

describe('runRules', () => {
  it('returns nothing for a clean page', () => {
    expect(runRules(base)).toEqual([])
  })
  it('flags meta length and missing meta', () => {
    const kinds = runRules({ ...base, metaTitle: 'Short', metaDescription: null }).map(f => [f.kind, f.severity])
    expect(kinds).toContainEqual(['meta_length', 'med'])
    expect(kinds).toContainEqual(['meta_missing', 'high'])
  })
  it('flags a body H1 and a skipped heading level', () => {
    const body = '# Title\n\n## A\n\n#### Deep\n'
    const kinds = runRules({ ...base, body }).map(f => f.kind)
    expect(kinds).toContain('heading_h1')
    expect(kinds).toContain('heading_skip')
  })
  it('flags no-go and client avoid phrases with the phrase as quote', () => {
    const body = base.body + '\nWe are your trusted partner in growth.\n'
    const f = runRules({ ...base, body, noGoPhrases: ['trusted partner'] }).find(x => x.kind === 'copy_banned_phrase')
    expect(f?.quote.toLowerCase()).toContain('trusted partner')
    expect(f?.safety).toBe('flag')
  })
  it('includes media alternation findings', () => {
    const body = base.body + '\n<!-- block: content-split | variant: image-right -->\n## B\n\nMore.\n'
    expect(runRules({ ...base, body }).some(f => f.kind === 'media_side')).toBe(true)
  })
})
