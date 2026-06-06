import { describe, expect, it } from 'vitest'
import { ensureBlockMedia, deriveQuery } from './ensure-block-media'

const PAGE = '/industries/healthcare-professionals'
const KW = 'healthcare professionals'

describe('ensureBlockMedia', () => {
  it('injects image + query into a content-split missing one', () => {
    const body = `<!-- block: content-split | variant: image-right -->\n## Our Approach\n\nProse here.`
    const out = ensureBlockMedia(body, PAGE, KW)
    expect(out).toContain(
      '<!-- block: content-split | variant: image-right | image: industries--healthcare-professionals--our-approach.jpg | query: "'
    )
    // Part order: block | variant | image | query
    expect(out).toMatch(/block: content-split \| variant: image-right \| image: [^|]+ \| query: "[^"]+" -->/)
  })

  it('leaves a content-split that already has an image byte-identical', () => {
    const body = `<!-- block: content-split | variant: image-left | image: existing.jpg | query: "team at work" -->\n## Section\n\nProse.`
    expect(ensureBlockMedia(body, PAGE, KW)).toBe(body)
  })

  it('leaves a fully-annotated comment (image + alt + query) byte-identical', () => {
    const body = `<!-- block: content-split | variant: image-left | image: x.jpg | alt: "Team reviewing reports" | query: "team at work" -->\n## Section\n\nProse.`
    expect(ensureBlockMedia(body, PAGE, KW)).toBe(body)
  })

  it('injects on with-image and no-variant checklists, skips standalone', () => {
    const withImage = `<!-- block: checklist-section | variant: with-image -->\n## Who We Serve\n\n- Item`
    const noVariant = `<!-- block: checklist-section -->\n## Who We Serve\n\n- Item`
    const standalone = `<!-- block: checklist-section | variant: standalone -->\n## Who We Serve\n\n- Item`
    expect(ensureBlockMedia(withImage, PAGE, KW)).toContain('image:')
    expect(ensureBlockMedia(noVariant, PAGE, KW)).toContain('image:')
    expect(ensureBlockMedia(standalone, PAGE, KW)).toBe(standalone)
  })

  it('injects on image-bg cta-banner, never on color-bg', () => {
    const imageBg = `<!-- block: cta-banner | variant: image-bg -->\n## Ready to Talk?\n\nCTA copy.`
    const colorBg = `<!-- block: cta-banner | variant: color-bg -->\n## Ready to Talk?\n\nCTA copy.`
    expect(ensureBlockMedia(imageBg, PAGE, KW)).toContain('image:')
    expect(ensureBlockMedia(colorBg, PAGE, KW)).toBe(colorBg)
  })

  it('does not touch non-image blocks', () => {
    const body = `<!-- block: feature-grid | variant: 3-col -->\n## Features\n\n### One\nicon: Star\nDesc.`
    expect(ensureBlockMedia(body, PAGE, KW)).toBe(body)
  })

  it('uses each section own heading when identical comments repeat', () => {
    const body = [
      `<!-- block: content-split | variant: image-right -->`,
      `## First Section`,
      ``,
      `Prose.`,
      ``,
      `<!-- block: content-split | variant: image-right -->`,
      `## Second Section`,
      ``,
      `Prose.`,
    ].join('\n')
    const out = ensureBlockMedia(body, PAGE, KW)
    expect(out).toContain('--first-section.jpg')
    expect(out).toContain('--second-section.jpg')
  })

  it('falls back to the block id when no heading follows', () => {
    const body = `<!-- block: content-split -->\nNo heading here.`
    const out = ensureBlockMedia(body, PAGE, KW)
    expect(out).toContain('image: industries--healthcare-professionals--content-split.jpg')
  })

  it('home page url maps to home slug', () => {
    const body = `<!-- block: content-split -->\n## Welcome\n\nProse.`
    const out = ensureBlockMedia(body, '/', 'cpa firm')
    expect(out).toContain('image: home--welcome.jpg')
  })
})

describe('deriveQuery', () => {
  it('drops stopwords and appends keyword words', () => {
    const q = deriveQuery('Who We Work With in Healthcare', 'healthcare professionals')
    expect(q.split(' ').length).toBeLessThanOrEqual(8)
    expect(q).not.toMatch(/\b(the|and|with|in|who|we)\b/)
    expect(q).toContain('healthcare')
    expect(q).toContain('professionals')
  })

  it('does not duplicate words already taken from the heading', () => {
    const q = deriveQuery('Healthcare Services', 'healthcare professionals')
    expect(q.match(/healthcare/g)?.length).toBe(1)
  })

  it('falls back to a generic subject when both inputs are empty', () => {
    expect(deriveQuery('', '')).toBe('professional business office')
  })
})
