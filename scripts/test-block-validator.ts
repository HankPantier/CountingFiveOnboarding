import {
  parseBlockAnnotations,
  validateBlockAnnotations,
} from '../lib/content/block-annotation-validator'
import { appendFaqBlock } from '../lib/content/deliverable-builder'
import type { Database } from '../types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

// ---------------------------------------------------------------------------
// Helper: create minimal GeneratedPage object with defaults
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<GeneratedPage> = {}): GeneratedPage {
  return {
    id: 'p1',
    content_job_id: 'j1',
    page_url: '/test',
    page_title: 'Test Page',
    content_markdown: null,
    meta_title: null,
    meta_description: null,
    target_keyword: null,
    secondary_keywords: null,
    url_slug: null,
    canonical_url: null,
    answer_block: null,
    schema_markup_type: null,
    eeat_signals: null,
    internal_links: null,
    faq_block: null,
    llm_citation_note: null,
    word_count_actual: null,
    word_count_target: null,
    admin_approved_content: false,
    client_approved_content: false,
    needs_client_review: false,
    generation_status: 'complete',
    hero_block: 'page-header',
    hero_variant: null,
    hero_image: null,
    created_at: '2026-05-18T00:00:00Z',
    ...overrides,
  } as GeneratedPage
}

// ---------------------------------------------------------------------------
// Test cases — parseBlockAnnotations
// ---------------------------------------------------------------------------

console.log('\n--- parseBlockAnnotations ---')

// Case 1: simple two-section page
const md1 = `<!-- block: intro-text | variant: centered -->
## Welcome

Some intro copy.

<!-- block: feature-grid | variant: 3-col -->
## What We Offer

- Icon: **Service A** — Description
- Icon: **Service B** — Description
`
const a1 = parseBlockAnnotations(md1)
assert('case 1: a1.length === 2', a1.length === 2, String(a1.length))
assert("case 1: a1[0].blockId === 'intro-text'", a1[0]?.blockId === 'intro-text', a1[0]?.blockId)
assert("case 1: a1[0].variant === 'centered'", a1[0]?.variant === 'centered', a1[0]?.variant)
assert("case 1: a1[0].headingText.trim() === 'Welcome'", a1[0]?.headingText.trim() === 'Welcome', a1[0]?.headingText)
assert('case 1: a1[0].position === 0', a1[0]?.position === 0, String(a1[0]?.position))
assert("case 1: a1[1].blockId === 'feature-grid'", a1[1]?.blockId === 'feature-grid', a1[1]?.blockId)
assert("case 1: a1[1].variant === '3-col'", a1[1]?.variant === '3-col', a1[1]?.variant)
assert('case 1: a1[1].position === 1', a1[1]?.position === 1, String(a1[1]?.position))

// Case 2: annotation with image
const md2 = `<!-- block: content-split | variant: image-right | image: photo.jpg -->
## A Section

Body.
`
const a2 = parseBlockAnnotations(md2)
assert("case 2: a2[0].image === 'photo.jpg'", a2[0]?.image === 'photo.jpg', a2[0]?.image)

// Case 3: annotation with no variant
const md3 = `<!-- block: content-prose -->
## Some Heading

Some content.
`
const a3 = parseBlockAnnotations(md3)
assert('case 3: a3[0].variant === undefined', a3[0]?.variant === undefined, String(a3[0]?.variant))
assert("case 3: a3[0].blockId === 'content-prose'", a3[0]?.blockId === 'content-prose', a3[0]?.blockId)

// ---------------------------------------------------------------------------
// Test cases — validateBlockAnnotations
// ---------------------------------------------------------------------------

console.log('\n--- validateBlockAnnotations ---')

// Case 4: fatal error — hero inline
const ann_hero_inline = parseBlockAnnotations(`<!-- block: hero | variant: image -->
## Should be in frontmatter

Body.
`)
const r4 = validateBlockAnnotations(ann_hero_inline, '/test', [])
assert('case 4: r4.passed === false', r4.passed === false)
assert('case 4: r4.errors.length >= 1', r4.errors.length >= 1, String(r4.errors.length))
assert("case 4: r4.errors[0].blockId === 'hero'", r4.errors[0]?.blockId === 'hero', r4.errors[0]?.blockId)

// Case 5: fatal error — faq-accordion inline
const ann_faq = parseBlockAnnotations(`<!-- block: faq-accordion -->
## FAQ

Q stuff.
`)
const r5 = validateBlockAnnotations(ann_faq, '/test', [])
assert('case 5: r5.passed === false', r5.passed === false)
assert("case 5: r5.errors.some(e => e.blockId === 'faq-accordion')", r5.errors.some(e => e.blockId === 'faq-accordion'))

// Case 6: fatal error — invalid block ID
const ann_unknown = parseBlockAnnotations(`<!-- block: not-a-real-block -->
## Heading

Body.
`)
const r6 = validateBlockAnnotations(ann_unknown, '/test', [])
assert('case 6: r6.passed === false', r6.passed === false)
assert('case 6: r6.errors.some(e => /unknown/i.test(e.reason))', r6.errors.some(e => /unknown/i.test(e.reason)))

// Case 7: fatal error — invalid variant
const ann_bad_variant = parseBlockAnnotations(`<!-- block: feature-grid | variant: bogus-variant -->
## Heading

Body.
`)
const r7 = validateBlockAnnotations(ann_bad_variant, '/test', [])
assert('case 7: r7.passed === false', r7.passed === false)
assert('case 7: r7.errors.some(e => /variant/i.test(e.reason))', r7.errors.some(e => /variant/i.test(e.reason)))

// Case 8: fatal error — stats-bar without numbers
const ann_stats = parseBlockAnnotations(`<!-- block: stats-bar | variant: 3-up -->
## By the Numbers

Hard work and dedication every day.
`)
const r8 = validateBlockAnnotations(ann_stats, '/test', [])
assert('case 8: r8.passed === false', r8.passed === false)
assert("case 8: r8.errors.some(e => e.blockId === 'stats-bar')", r8.errors.some(e => e.blockId === 'stats-bar'))

// Case 9: fatal error — cta-banner at position 0
const ann_cta_first = parseBlockAnnotations(`<!-- block: cta-banner | variant: color-bg -->
## Ready to Start?

Call us.
`)
const r9 = validateBlockAnnotations(ann_cta_first, '/test', [])
assert('case 9: r9.passed === false', r9.passed === false)
assert("case 9: r9.errors.some(e => e.blockId === 'cta-banner' && e.position === 0)", r9.errors.some(e => e.blockId === 'cta-banner' && e.position === 0))

// Case 10: clean page (no fatal errors, no warnings)
const ann_clean = parseBlockAnnotations(`<!-- block: intro-text | variant: centered -->
## Welcome

This is a clean intro paragraph that introduces what follows on the page.

<!-- block: feature-grid | variant: 3-col -->
## Services

- Icon: **One** — Description here.
- Icon: **Two** — Description here.
- Icon: **Three** — Description here.

<!-- block: cta-banner | variant: color-bg -->
## Ready?

Final call to action.
`)
const r10 = validateBlockAnnotations(ann_clean, '/test', [])
assert('case 10: r10.passed === true', r10.passed === true)
assert('case 10: r10.errors.length === 0', r10.errors.length === 0, String(r10.errors.length))

// Case 11: warning — consecutive content-split same variant
const ann_consec = parseBlockAnnotations(`<!-- block: intro-text | variant: centered -->
## Intro

Intro.

<!-- block: content-split | variant: image-right | image: a.jpg -->
## Section A

Body A.

<!-- block: content-split | variant: image-right | image: b.jpg -->
## Section B

Body B.
`)
const r11 = validateBlockAnnotations(ann_consec, '/test', [])
assert('case 11: r11.passed === true', r11.passed === true)
assert('case 11: r11.warnings.length >= 1', r11.warnings.length >= 1, String(r11.warnings.length))
assert('case 11: r11.warnings.some(w => /content-split/.test(w))', r11.warnings.some(w => /content-split/.test(w)))

// ---------------------------------------------------------------------------
// Test cases — appendFaqBlock
// ---------------------------------------------------------------------------

console.log('\n--- appendFaqBlock ---')

// Case 12: FAQ append when CTA closes the page
const page12 = makePage({
  content_markdown: `<!-- block: intro-text -->
## Intro

Some intro copy.

<!-- block: cta-banner | variant: color-bg -->
## Get in Touch

Call us today.`,
  faq_block: [
    { question: 'Do you offer free consults?', answer: 'Yes, the first consult is free.' },
    { question: 'What hours are you open?', answer: 'Monday–Friday, 9am to 5pm.' },
  ] as unknown as typeof page12.faq_block,
})
const out12 = appendFaqBlock(page12)
assert("case 12: out12.includes('<!-- block: faq-accordion -->')", out12.includes('<!-- block: faq-accordion -->'))
assert("case 12: out12.includes('Frequently Asked Questions About Test Page')", out12.includes('Frequently Asked Questions About Test Page'))
assert("case 12: out12.includes('**Q: Do you offer free consults?**')", out12.includes('**Q: Do you offer free consults?**'))
assert("case 12: out12.includes('A: Yes, the first consult is free.')", out12.includes('A: Yes, the first consult is free.'))
const faqIdx12 = out12.indexOf('<!-- block: faq-accordion -->')
const ctaIdx12 = out12.indexOf('<!-- block: cta-banner')
assert('case 12: FAQ appears BEFORE cta-banner', faqIdx12 < ctaIdx12, `faqIdx=${faqIdx12}, ctaIdx=${ctaIdx12}`)

// Case 13: FAQ append when no terminal block — appended at end
const page13 = makePage({
  content_markdown: `<!-- block: intro-text -->
## Intro

Some intro copy.

<!-- block: feature-grid | variant: 3-col -->
## What We Do

- Icon: **A** — Description
- Icon: **B** — Description`,
  faq_block: [{ question: 'Q?', answer: 'A.' }] as unknown as typeof page13.faq_block,
})
const out13 = appendFaqBlock(page13)
assert("case 13: out13.includes('<!-- block: faq-accordion -->')", out13.includes('<!-- block: faq-accordion -->'))
const faqIdx13 = out13.indexOf('<!-- block: faq-accordion -->')
const featureIdx13 = out13.indexOf('<!-- block: feature-grid')
assert('case 13: FAQ appears AFTER feature-grid', featureIdx13 < faqIdx13, `featureIdx=${featureIdx13}, faqIdx=${faqIdx13}`)

// Case 14: no FAQ block — content returned unchanged
const page14 = makePage({
  content_markdown: `<!-- block: intro-text -->\n## Hi\n\nHello.`,
  faq_block: [],
})
const out14 = appendFaqBlock(page14)
assert('case 14: out14 === page14.content_markdown', out14 === page14.content_markdown)

// Case 15: null content_markdown — empty string returned
const page15 = makePage({
  content_markdown: null,
  faq_block: [{ question: 'Q', answer: 'A' }] as unknown as typeof page15.faq_block,
})
const out15 = appendFaqBlock(page15)
assert("case 15: out15 === ''", out15 === '')

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
