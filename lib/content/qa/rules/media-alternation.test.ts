import { describe, it, expect } from 'vitest'
import { checkMediaAlternation } from './media-alternation'

const sec = (block: string, variant: string | null, heading: string) =>
  `<!-- block: ${block}${variant ? ` | variant: ${variant}` : ''} -->\n## ${heading}\n\nBody for ${heading}.\n`
const noHero = { block: 'hero', variant: 'image' }

describe('checkMediaAlternation', () => {
  it('passes a correctly alternating page', () => {
    const body = [sec('content-split', 'image-right', 'A'), sec('content-split', 'image-left', 'B')].join('\n')
    expect(checkMediaAlternation(body, noHero)).toEqual([])
  })

  it('flags the second of two same-side splits with a flip fix', () => {
    const body = [sec('content-split', 'image-right', 'A'), sec('content-split', 'image-right', 'B')].join('\n')
    const [f] = checkMediaAlternation(body, noHero)
    expect(f.kind).toBe('media_side')
    expect(f.safety).toBe('auto')
    expect(f.variantFix).toEqual({ sectionIndex: 1, variant: 'image-left' })
    expect(f.quote).toBe('B')
  })

  it('carries the expected side across non-media blocks and covers checklists', () => {
    const body = [
      sec('content-split', 'image-left', 'A'),
      sec('content-prose', null, 'Prose'),
      sec('checklist-section', 'with-image-left', 'C'),
    ].join('\n')
    const [f] = checkMediaAlternation(body, noHero)
    expect(f.variantFix).toEqual({ sectionIndex: 2, variant: 'with-image-right' })
  })

  it('treats a no-variant content-split as image-right', () => {
    const body = [sec('content-split', 'image-right', 'A'), sec('content-split', null, 'B')].join('\n')
    expect(checkMediaAlternation(body, noHero)[0].variantFix).toEqual({ sectionIndex: 1, variant: 'image-left' })
  })

  it('ignores standalone checklists', () => {
    const body = [sec('content-split', 'image-right', 'A'), sec('checklist-section', 'standalone', 'C'), sec('content-split', 'image-left', 'B')].join('\n')
    expect(checkMediaAlternation(body, noHero)).toEqual([])
  })

  it('starts opposite a hero-split side', () => {
    const body = sec('content-split', 'image-right', 'A')
    const [f] = checkMediaAlternation(body, { block: 'hero-split', variant: 'image-right' })
    expect(f.variantFix).toEqual({ sectionIndex: 0, variant: 'image-left' })
  })

  it('fixes greedily so a long run flips every other block', () => {
    const body = ['A', 'B', 'C', 'D'].map(h => sec('content-split', 'image-right', h)).join('\n')
    const fixes = checkMediaAlternation(body, noHero).map(f => f.variantFix?.sectionIndex)
    expect(fixes).toEqual([1, 3])
  })
})
