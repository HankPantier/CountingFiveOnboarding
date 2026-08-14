import { describe, expect, it } from 'vitest'
import {
  parseBlockAnnotations,
  validateBlockAnnotations,
  type BlockAnnotation,
} from './block-annotation-validator'

function ann(partial: Partial<BlockAnnotation> & { blockId: string }): BlockAnnotation {
  return {
    variant: undefined,
    image: undefined,
    headingText: 'Section Heading',
    sectionContent: 'Some prose content for the section body goes here.',
    position: 0,
    ...partial,
  }
}

describe('mandatory image rules', () => {
  it('errors on content-split without image, with fix add-image', () => {
    const res = validateBlockAnnotations([ann({ blockId: 'content-split', variant: 'image-right' })], '/services', [])
    const err = res.errors.find((e) => e.blockId === 'content-split')
    expect(err).toBeDefined()
    expect(err!.fix).toBe('add-image')
    expect(res.passed).toBe(false)
  })

  it('passes content-split with image', () => {
    const res = validateBlockAnnotations(
      [ann({ blockId: 'content-split', variant: 'image-right', image: 'x.jpg' })],
      '/services',
      []
    )
    expect(res.errors.filter((e) => e.blockId === 'content-split')).toHaveLength(0)
  })

  it('errors on with-image and no-variant checklist without image; standalone is exempt', () => {
    const withImage = validateBlockAnnotations(
      [ann({ blockId: 'checklist-section', variant: 'with-image' })],
      '/x',
      []
    )
    const noVariant = validateBlockAnnotations([ann({ blockId: 'checklist-section' })], '/x', [])
    const standalone = validateBlockAnnotations(
      [ann({ blockId: 'checklist-section', variant: 'standalone' })],
      '/x',
      []
    )
    expect(withImage.errors.some((e) => e.fix === 'add-image')).toBe(true)
    expect(noVariant.errors.some((e) => e.fix === 'add-image')).toBe(true)
    expect(standalone.errors.some((e) => e.fix === 'add-image')).toBe(false)
  })

  it('treats with-image-left/right checklist as image-bearing (add-image without a photo)', () => {
    for (const variant of ['with-image-left', 'with-image-right']) {
      const res = validateBlockAnnotations(
        [ann({ blockId: 'checklist-section', variant })],
        '/x',
        []
      )
      expect(res.errors.some((e) => e.fix === 'add-image')).toBe(true)
    }
  })

  it('accepts a with-image-left checklist as a valid variant (no coercion)', () => {
    const res = validateBlockAnnotations(
      [ann({ blockId: 'checklist-section', variant: 'with-image-left', image: 'x.jpg' })],
      '/x',
      []
    )
    expect(res.coercions).toHaveLength(0)
    expect(res.errors.filter((e) => e.blockId === 'checklist-section')).toHaveLength(0)
  })

  it('errors on image-bg cta-banner without image; color-bg is exempt', () => {
    const imageBg = validateBlockAnnotations(
      [ann({ blockId: 'cta-banner', variant: 'image-bg' })],
      '/x',
      []
    )
    const colorBg = validateBlockAnnotations(
      [ann({ blockId: 'cta-banner', variant: 'color-bg' })],
      '/x',
      []
    )
    expect(imageBg.errors.some((e) => e.fix === 'add-image')).toBe(true)
    expect(colorBg.errors.some((e) => e.fix === 'add-image')).toBe(false)
  })
})

describe('icon coverage warnings', () => {
  const cards = (content: string, blockId = 'service-cards') =>
    validateBlockAnnotations([ann({ blockId, variant: '3-col', sectionContent: content })], '/x', [])

  it('warns (never errors) when items lack icon lines', () => {
    const res = cards('### One\nDescription only.\n\n### Two\nicon: Star\nDescription.')
    expect(res.warnings.some((w) => w.includes('without an icon'))).toBe(true)
    expect(res.errors).toHaveLength(0)
    expect(res.passed).toBe(true)
  })

  it('stays quiet when every item has an icon', () => {
    const res = cards('### One\nicon: Star\nDesc.\n\n### Two\nicon: Zap\nDesc.')
    expect(res.warnings.some((w) => w.includes('without an icon'))).toBe(false)
  })

  it('covers feature-grid and industry-cards too', () => {
    for (const blockId of ['feature-grid', 'industry-cards']) {
      const res = cards('### One\nNo icon here.', blockId)
      expect(res.warnings.some((w) => w.includes('without an icon'))).toBe(true)
    }
  })

  it('counts bold-paragraph item titles', () => {
    const res = cards('**Bold Item**\nNo icon line follows.')
    expect(res.warnings.some((w) => w.includes('without an icon'))).toBe(true)
  })
})

describe('regression: existing rules still fire', () => {
  it('rejects inline hero blocks', () => {
    const res = validateBlockAnnotations([ann({ blockId: 'hero', variant: 'image' })], '/x', [])
    expect(res.passed).toBe(false)
  })

  it('parseBlockAnnotations still captures image attribute', () => {
    const md = `<!-- block: content-split | variant: image-left | image: a.jpg | query: "b c" -->\n## H\n\nBody.`
    const parsed = parseBlockAnnotations(md)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].image).toBe('a.jpg')
  })
})
