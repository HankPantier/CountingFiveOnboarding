import { describe, expect, it } from 'vitest'
import { ensureBlockMedia } from './ensure-block-media'
import { extractInlineImageRefs } from './image-ref-extractor'
import { parseBlockAnnotations, validateBlockAnnotations } from './block-annotation-validator'

// End-to-end coverage guarantee: a page shaped like the real Korbey output
// (image-capable blocks with NO images — the exact gap that shipped) must,
// after ensureBlockMedia, yield a resolvable Pexels ref for every structural
// image slot and pass validation.
const KORBEY_STYLE_PAGE = [
  '<!-- block: intro-text | variant: left-aligned -->',
  '## Your Practice Has Financial Complexity',
  '',
  'Intro prose.',
  '',
  '<!-- block: checklist-section | variant: with-image -->',
  '## Who We Work With in Healthcare',
  '',
  '- **Physicians and surgeons** — primary care and specialty',
  '- **Dentists and orthodontists**',
  '',
  '<!-- block: content-split | variant: image-right -->',
  '## Our Approach',
  '',
  'Narrative prose with a supporting image slot.',
  '',
  '<!-- block: service-cards | variant: 3-col -->',
  '## Services Designed Around Your Practice',
  '',
  '### Entity Structure and Setup',
  'icon: Building2',
  'Structure determines taxation.',
  '',
  '### Payroll for Clinical Staff',
  'icon: Users',
  'Accurate, on-time payroll.',
  '',
  '<!-- block: cta-banner | variant: image-bg -->',
  '## Ready to Stop Managing Your Finances Alone?',
  '',
  'CTA copy here.',
].join('\n')

const PAGE_URL = '/industries/healthcare-professionals'
const KEYWORD = 'healthcare professionals'

describe('guaranteed media coverage (Korbey-style fixture)', () => {
  it('every structural image slot yields a resolvable ref after injection', () => {
    const ensured = ensureBlockMedia(KORBEY_STYLE_PAGE, PAGE_URL, KEYWORD)
    const refs = extractInlineImageRefs(ensured, PAGE_URL)

    const bySource = Object.fromEntries(refs.map((r) => [r.source, r]))
    expect(bySource['checklist-section']).toBeDefined()
    expect(bySource['content-split']).toBeDefined()
    expect(bySource['cta-banner']).toBeDefined()

    for (const ref of refs) {
      expect(ref.filename).toMatch(/^[a-z0-9-]+\.jpg$/)
      expect(ref.subjectQuery.trim().length).toBeGreaterThan(0)
      expect(ref.subjectQuery.split(' ').length).toBeLessThanOrEqual(8)
    }
  })

  it('the ensured page passes block validation with zero image errors', () => {
    const ensured = ensureBlockMedia(KORBEY_STYLE_PAGE, PAGE_URL, KEYWORD)
    const annotations = parseBlockAnnotations(ensured)
    expect(annotations.length).toBe(5)
    const result = validateBlockAnnotations(annotations, PAGE_URL, [])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.filter((w) => w.includes('without an icon'))).toHaveLength(0)
  })

  it('pre-injection, the same page fails validation (the old shipped state)', () => {
    const annotations = parseBlockAnnotations(KORBEY_STYLE_PAGE)
    const result = validateBlockAnnotations(annotations, PAGE_URL, [])
    expect(result.errors.filter((e) => e.fix === 'add-image').length).toBe(3)
  })
})
