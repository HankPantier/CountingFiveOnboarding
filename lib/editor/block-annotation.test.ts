import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findBlockComments, parseBlockComment, rendersAsSection, replaceBlockComments, serializeBlockComment, templateSectionPattern } from './block-annotation'
import { joinSections, splitSections } from './markdown-sections'
import { describeSections } from './section-reorder'
import { extractImageBlocks, setBlockAlt, setBlockImage } from './block-images'
import { setFaqAccordionBody } from './page-body'

// Trimmed real client page bodies (fleet draft branches, 2026-09-28): ink
// bands, image cta/checklist annotations, stray heading-less annotations
// (inline hero-split, map), a legacy content-table variant, `variant:4-up`.
const FIX = path.join(__dirname, '__fixtures__', 'block-bodies')
const fixtures = readdirSync(FIX)
  .filter((f) => f.endsWith('.md'))
  .map((f) => [f, readFileSync(path.join(FIX, f), 'utf-8')] as const)
const annotationLines = (body: string) => body.split('\n').filter((l) => l.startsWith('<!-- block:'))

describe('parseBlockComment', () => {
  it('reads every field in template order', () => {
    expect(
      parseBlockComment('<!-- block: cta-banner | variant: image-bg | image: a.jpg | alt: "An office" | query: "office" | theme: ink -->')
    ).toEqual({ blockId: 'cta-banner', variant: 'image-bg', image: 'a.jpg', alt: 'An office', query: 'office', theme: 'ink', strict: true })
    expect(parseBlockComment('<!-- block: faq-accordion -->')).toEqual({ blockId: 'faq-accordion', strict: true })
    expect(parseBlockComment('<!-- block: stats-bar | variant:4-up -->')).toMatchObject({ variant: '4-up', strict: true })
  })

  it('falls back leniently (strict: false) for what the template would not parse', () => {
    expect(parseBlockComment('<!-- block: content-split | theme: ink | variant: image-left -->')).toEqual({
      blockId: 'content-split',
      variant: 'image-left',
      theme: 'ink',
      strict: false,
    })
    expect(parseBlockComment('<!--block: Intro-Text | variant: Left Aligned | size: big -->')).toEqual({
      blockId: 'intro-text',
      variant: 'Left Aligned',
      strict: false,
    })
  })

  it('returns null for a non-annotation', () => {
    expect(parseBlockComment('<!-- block: content-split')).toBeNull()
    expect(parseBlockComment('## Heading')).toBeNull()
  })
})

describe('serializeBlockComment', () => {
  it('writes the canonical order whatever order the fields come in', () => {
    expect(serializeBlockComment({ theme: 'ink', blockId: 'cta-banner', query: 'q', variant: 'image-bg', image: 'a.jpg' })).toBe(
      '<!-- block: cta-banner | variant: image-bg | image: a.jpg | query: "q" | theme: ink -->'
    )
  })
  it('strips quotes from quoted fields and drops an empty query', () => {
    expect(serializeBlockComment({ blockId: 'content-split', image: 'a.jpg', alt: 'say "hi"', query: '' })).toBe(
      '<!-- block: content-split | image: a.jpg | alt: "say hi" -->'
    )
  })
})

describe('real client bodies', () => {
  it.each(fixtures)('%s: every strict annotation round-trips byte for byte', (_name, body) => {
    const lines = annotationLines(body)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const c = parseBlockComment(line)
      expect(c, line).not.toBeNull()
      if (c!.strict) {
        const { strict: _s, ...fields } = c!
        // `variant:4-up` (no space) is the one non-canonical strict form seen in the fleet.
        if (!line.includes('variant:4-up')) expect(serializeBlockComment(fields)).toBe(line)
      }
    }
  })

  it.each(fixtures)('%s: split/join is byte-identical', (_name, body) => {
    expect(joinSections(splitSections(body))).toBe(body)
  })

  it('the outline now sees image + ink sections with their variant and theme', () => {
    const body = fixtures.find(([n]) => n === 'abramson-contact.md')![1]
    const { sections } = describeSections(body)
    const ink = sections.find((s) => s.blockId === 'industry-cards')!
    expect(ink).toMatchObject({ variant: '3-col', theme: 'ink', parseable: true })
    const split = sections.find((s) => s.blockId === 'content-split')!
    expect(split).toMatchObject({ variant: 'image-right', parseable: true, heading: 'Serving clients near and far' })
    // The heading-less map annotation is stray: shown, but never rewritable.
    expect(sections.find((s) => s.blockId === 'map')).toMatchObject({ parseable: false })
    expect(sections.every((s) => s.blockId !== '')).toBe(true)
  })

  it('marks the stray inline hero-split as not parseable', () => {
    const body = fixtures.find(([n]) => n === 'accord-succession-planning.md')![1]
    const first = describeSections(body).sections[0]
    expect(first).toMatchObject({ blockId: 'hero-split', parseable: false })
  })
})

describe('rendersAsSection', () => {
  it('mirrors the template: a heading must follow, optionally after blank lines', () => {
    expect(rendersAsSection('<!-- block: map -->', '## Where\n')).toBe(true)
    expect(rendersAsSection('<!-- block: map -->', '\n## Where\n')).toBe(true)
    expect(rendersAsSection('<!-- block: map -->', '\n<!-- block: form -->\n')).toBe(false)
    expect(rendersAsSection('<!-- block: map -->', 'Prose first\n## Later\n')).toBe(false)
  })
})

describe('block images keep the ink theme', () => {
  const INK = '<!-- block: cta-banner | variant: image-bg | image: a.jpg | alt: "Old" | query: "q" | theme: ink -->\n## Talk\n\nBody\n'
  it('lists an ink cta as an image block and rewrites it without losing the theme', () => {
    const [ref] = extractImageBlocks(INK)
    expect(ref).toMatchObject({ blockId: 'cta-banner', image: 'a.jpg', alt: 'Old', heading: 'Talk' })
    expect(setBlockImage(INK, ref, 'b.jpg')).toBe(INK.replace('a.jpg', 'b.jpg'))
    expect(setBlockAlt(INK, ref, 'New')).toBe(INK.replace('"Old"', '"New"'))
    expect(setBlockImage(INK, ref, null)).toBe(
      '<!-- block: cta-banner | variant: image-bg | query: "q" | theme: ink -->\n## Talk\n\nBody\n'
    )
  })
})

describe('FAQ marker', () => {
  it('keeps a non-canonical marker line verbatim when rewriting the FAQ', () => {
    const body = '<!-- block: intro-text -->\n## Hi\n\nx\n\n<!-- block: faq-accordion | theme: ink -->\n## Questions\n\n**Q: A?**\nA: B.\n'
    const next = setFaqAccordionBody(body, [{ question: 'C?', answer: 'D.' }], 'FAQ')
    expect(next).toContain('<!-- block: faq-accordion | theme: ink -->\n## Questions\n\n**Q: C?**\nA: D.')
    expect(next).not.toContain('**Q: A?**')
  })
})

describe('shared finders', () => {
  const body = '<!-- block: map -->\n\n<!-- block: industry-cards | variant: 3-col | theme: ink -->\n## Who\n\nx\n'
  it('templateSectionPattern sees exactly the rendered sections, theme included', () => {
    const ms = [...body.matchAll(templateSectionPattern())]
    expect(ms.map((m) => [m[1], m[2], m[6], m[7]])).toEqual([['industry-cards', '3-col', 'ink', 'Who']])
  })
  it('findBlockComments / replaceBlockComments visit every comment in order', () => {
    expect(findBlockComments(body).map((f) => f.comment?.blockId)).toEqual(['map', 'industry-cards'])
    expect(replaceBlockComments(body, (f) => f.raw)).toBe(body)
    expect(replaceBlockComments(body, (f, i) => (i === 0 ? '<!-- block: contact-info -->' : f.raw))).toContain('contact-info')
  })
})
