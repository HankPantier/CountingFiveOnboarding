import { describe, expect, it } from 'vitest'
import {
  blockCatalogHint,
  heroPairWarnings,
  parseBlockAnnotations,
  validateAnnotationDelta,
  validateAnnotationSyntax,
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

describe('catalog from the template contract', () => {
  it('hints only insertable blocks, including form custom', () => {
    const hint = blockCatalogHint()
    expect(hint).toContain('form (contact|quote|newsletter|custom)')
    expect(hint).toContain('content-prose')
    for (const id of ['hero', 'hero-split', 'page-header', 'faq-accordion', 'contact-info', 'map', 'booking', 'resource-list', 'pricing-calculator', 'pricing-plans']) {
      expect(hint.split(', ').some((part) => part === id || part.startsWith(`${id} (`))).toBe(false)
    }
  })

  it('filters hint variants by template version when asked', () => {
    // No marker = the baseline; 2026.09.8 predates the layout variants.
    const base = blockCatalogHint({ templateVersion: '2026.09.8' })
    expect(blockCatalogHint({ templateVersion: null })).toBe(base)
    expect(base).toContain('service-cards (2-col|3-col)')
    expect(base).not.toMatch(/\blist\b|featured|-centered/)
    // 2026.09.9 adds them; the unversioned hint is the full contract.
    const next = blockCatalogHint({ templateVersion: '2026.09.9' })
    expect(next).toContain('service-cards (2-col|3-col|list)')
    expect(next).toContain('testimonials (carousel|grid|featured)')
    expect(next).toContain('cta-banner (color-bg|image-bg|color-bg-centered|image-bg-centered)')
    expect(blockCatalogHint()).toBe(next)
  })

  it('parses ink sections (theme: after query:) instead of skipping them', () => {
    const md = `<!-- block: industry-cards | variant: 3-col | theme: ink -->\n## Who we serve\n\nBody.\n\n<!-- block: cta-banner | variant: image-bg | image: a.jpg | alt: "A" | query: "q" | theme: ink -->\n## Talk to us\n\nBody.`
    const parsed = parseBlockAnnotations(md)
    expect(parsed.map((a) => [a.blockId, a.theme, a.image])).toEqual([
      ['industry-cards', 'ink', undefined],
      ['cta-banner', 'ink', 'a.jpg'],
    ])
  })

  it('knows the platform-inserted blocks and hero statement / form custom', () => {
    const body = ['contact-info', 'map', 'booking', 'resource-list', 'pricing-calculator', 'pricing-plans']
      .map((id) => `<!-- block: ${id} -->\n## ${id}\n\nx\n`)
      .join('\n') + `\n<!-- block: form | variant: custom -->\n## Form\n\n- Name (text)\n`
    expect(validateAnnotationSyntax(body)).toEqual([])
    expect(heroPairWarnings('hero', 'statement')).toEqual([])
  })

  it('generation still rejects platform-inserted blocks the model picked', () => {
    const res = validateBlockAnnotations([ann({ blockId: 'contact-info' })], '/contact', [])
    expect(res.errors[0].reason).toContain('inserted by the platform')
    const faq = validateBlockAnnotations([ann({ blockId: 'faq-accordion' })], '/x', [])
    expect(faq.errors[0].reason).toContain('auto-appended')
  })

  it('warns on an unsupported theme during generation', () => {
    const res = validateBlockAnnotations([ann({ blockId: 'intro-text', variant: 'centered', theme: 'ink' })], '/x', [])
    expect(res.warnings.some((w) => w.includes("theme 'ink'"))).toBe(true)
  })

  it('keeps coercing an invalid variant to the first listed value', () => {
    const res = validateBlockAnnotations([ann({ blockId: 'checklist-section', variant: 'default', image: 'a.jpg' })], '/x', [])
    expect(res.coercions[0].coercedVariant).toBe('with-image')
  })
})

describe('validateAnnotationDelta', () => {
  const legacy = `<!-- block: checklist-section | variant: default -->\n## A\n\n- x\n\n<!-- block: content-prose | variant: null -->\n## B\n\nText.\n`
  it('ignores legacy issues the edit did not introduce', () => {
    expect(validateAnnotationSyntax(legacy)).toHaveLength(2)
    expect(validateAnnotationDelta(legacy, legacy.replace('## B', '## B2'))).toEqual([])
  })
  it('reports new issues', () => {
    const next = legacy + `\n<!-- block: stats-bar | variant: 5-up -->\n## C\n\n- **1** x\n`
    expect(validateAnnotationDelta(legacy, next)).toEqual([expect.stringContaining('5-up')])
  })
  it('a fixed legacy value never counts against a new one elsewhere of a different kind', () => {
    const next = legacy.replace('variant: default', 'variant: standalone').replace('## B', '## B') + `\n<!-- block: widget -->\n## W\n\nx\n`
    expect(validateAnnotationDelta(legacy, next)).toEqual([expect.stringContaining('widget')])
  })
})

describe('heroPairWarnings', () => {
  it('flags dead image-left/right on hero with the hero-split suggestion', () => {
    expect(heroPairWarnings('hero', 'image-right')[0]).toContain('hero-split')
  })
  it('accepts valid pairs and ignores empty ones', () => {
    expect(heroPairWarnings('hero-split', 'image-left')).toEqual([])
    expect(heroPairWarnings('page-header', undefined)).toEqual([])
    expect(heroPairWarnings(undefined, undefined)).toEqual([])
    expect(heroPairWarnings(undefined, 'image')[0]).toContain('without hero')
    expect(heroPairWarnings('  ', 'image')[0]).toContain('without hero')
    expect(heroPairWarnings('page-header', 'image')[0]).toContain('ignored')
  })
})

describe('unrendered annotations', () => {
  const base = `<!-- block: intro-text | variant: centered -->\n## A\n\nText.\n`
  it('rejects a mangled annotation an edit introduces', () => {
    const next = base.replace('intro-text | variant: centered', 'intro-text | variant: Left Aligned')
    expect(validateAnnotationDelta(base, next)).toEqual([expect.stringContaining('template grammar')])
  })
  it('rejects a heading-less annotation an edit introduces, but not a legacy one', () => {
    const stray = `<!-- block: map -->\n\n${base}`
    expect(validateAnnotationSyntax(stray)).toEqual([expect.stringContaining('## Heading')])
    expect(validateAnnotationDelta(base, stray)).toHaveLength(1)
    expect(validateAnnotationDelta(stray, stray.replace('Text.', 'More text.'))).toEqual([])
  })
})
