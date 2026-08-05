import { describe, it, expect } from 'vitest'
import { applyInkBands, deriveHeroEyebrow, isHomePage } from './design-variant-injector'

describe('applyInkBands', () => {
  it('appends theme: ink to an industry-cards annotation', () => {
    const md = '<!-- block: industry-cards | variant: 3-col -->\n## Industries\nbody'
    expect(applyInkBands(md)).toContain('<!-- block: industry-cards | variant: 3-col | theme: ink -->')
  })

  it('is idempotent — leaves an existing theme untouched', () => {
    const md = '<!-- block: industry-cards | variant: 3-col | theme: ink -->\n## X'
    expect(applyInkBands(md)).toBe(md)
  })

  it('handles an annotation with an image attribute', () => {
    const md = '<!-- block: industry-cards | variant: 4-col | image: a.jpg | alt: "x" -->\n## X'
    expect(applyInkBands(md)).toContain('| alt: "x" | theme: ink -->')
  })

  it('does not touch other block types', () => {
    const md = '<!-- block: feature-grid | variant: 3-col -->\n## X'
    expect(applyInkBands(md)).toBe(md)
  })

  it('themes multiple industry-cards blocks on one page', () => {
    const md =
      '<!-- block: industry-cards | variant: 3-col -->\n## A\n' +
      '<!-- block: industry-cards | variant: 4-col -->\n## B'
    const out = applyInkBands(md)
    expect(out.match(/theme: ink/g)).toHaveLength(2)
  })
})

describe('deriveHeroEyebrow', () => {
  it('builds place · Since year', () => {
    expect(deriveHeroEyebrow({ city: 'Port Arthur', state: 'TX', foundingYear: '1950' })).toBe(
      'Port Arthur, TX · Since 1950',
    )
  })

  it('omits the missing pieces', () => {
    expect(deriveHeroEyebrow({ city: 'Boston', state: 'MA' })).toBe('Boston, MA')
    expect(deriveHeroEyebrow({ foundingYear: '1999' })).toBe('Since 1999')
  })

  it('returns undefined when there is nothing to show', () => {
    expect(deriveHeroEyebrow({})).toBeUndefined()
    expect(deriveHeroEyebrow({ city: '  ', state: null, foundingYear: undefined })).toBeUndefined()
  })
})

describe('isHomePage', () => {
  it('matches the site root', () => {
    expect(isHomePage('/')).toBe(true)
    expect(isHomePage('https://bblcpa.com/')).toBe(true)
    expect(isHomePage('https://bblcpa.com')).toBe(true)
  })

  it('rejects inner pages, empty, and null', () => {
    expect(isHomePage('/services')).toBe(false)
    expect(isHomePage('https://bblcpa.com/about')).toBe(false)
    expect(isHomePage('')).toBe(false)
    expect(isHomePage(null)).toBe(false)
  })
})
