import { describe, expect, it } from 'vitest'
import {
  scanBodySegments,
  serializeBodySegments,
  splitProseParts,
  joinProseParts,
} from './body-segments'
import { setCardTitle, addCard } from './structured-blocks/card-blocks'

// A body exercising every structural shape the scanner must protect: a prose
// intro block, a content-split with prose, a feature-grid with icon chunks, a
// team-grid with photos, and a faq-accordion with Q&A pairs.
const BODY = `<!-- block: intro-text -->
## Welcome

Prose here with **bold** and a [link](/x).

<!-- block: content-split | variant: image-right | image: team.png | alt: "team" -->
## About Us

More prose describing the firm.

<!-- block: feature-grid -->
## Services

### Tax Prep
icon: FileText
Year-round tax planning.

### Bookkeeping
icon: Calculator
Clean books, monthly.

<!-- block: team-grid | variant: 3-col -->
## Our Team

### Ron Lague, CPA
photo: ron.jpg
Ron leads the firm.

<!-- block: faq-accordion -->
## Frequently Asked Questions

**Q: Do you offer payroll?**
A: Yes, weekly or monthly.`

describe('scanBodySegments / serializeBodySegments', () => {
  it('round-trips byte-identically', () => {
    expect(serializeBodySegments(scanBodySegments(BODY))).toBe(BODY)
  })

  it('round-trips empty, blank, and trailing-newline bodies', () => {
    for (const b of ['', '\n', '\n\n', 'plain text', 'text\n']) {
      expect(serializeBodySegments(scanBodySegments(b))).toBe(b)
    }
  })

  it('keeps block annotations, icon, and photo lines structural', () => {
    const segs = scanBodySegments(BODY)
    const structural = segs.filter((s) => s.kind === 'structural').map((s) => s.text).join('\n')
    expect(structural).toContain('<!-- block: intro-text -->')
    expect(structural).toContain('icon: FileText')
    expect(structural).toContain('photo: ron.jpg')
  })

  it('marks the entire feature-grid, team-grid, and faq-accordion as structural', () => {
    const segs = scanBodySegments(BODY)
    const prose = segs.filter((s) => s.kind === 'prose').map((s) => s.text).join('\n')
    // Prose blocks are editable...
    expect(prose).toContain('Prose here with **bold**')
    expect(prose).toContain('More prose describing the firm.')
    // ...structured-block content is not.
    expect(prose).not.toContain('Year-round tax planning.')
    expect(prose).not.toContain('Ron leads the firm.')
    expect(prose).not.toContain('Do you offer payroll')
  })

  it('classifies inline-image and table lines as structural', () => {
    const b = 'A paragraph.\n\n![alt](photo.png)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'
    const segs = scanBodySegments(b)
    const prose = segs.filter((s) => s.kind === 'prose').map((s) => s.text).join('\n')
    expect(prose).toContain('A paragraph.')
    expect(prose).not.toContain('![alt](photo.png)')
    expect(prose).not.toContain('| a | b |')
  })

  it('editing one prose segment leaves all structural bytes untouched', () => {
    const segs = scanBodySegments(BODY)
    const target = segs.findIndex((s) => s.kind === 'prose' && s.text.includes('Prose here'))
    expect(target).toBeGreaterThanOrEqual(0)
    const parts = splitProseParts(segs[target].text)
    const edited = segs.map((s, i) =>
      i === target ? { ...s, text: joinProseParts(parts, '## Welcome\n\nEdited prose.') } : s
    )
    const next = serializeBodySegments(edited)
    expect(next).toContain('Edited prose.')
    expect(next).not.toContain('Prose here with')
    // Every structural line survives verbatim.
    expect(next).toContain('<!-- block: content-split | variant: image-right | image: team.png | alt: "team" -->')
    expect(next).toContain('icon: FileText')
    expect(next).toContain('photo: ron.jpg')
    expect(next).toContain('**Q: Do you offer payroll?**')
  })
})

// Integration: the inline structured-block editors hand updateStructural a
// byte-surgical rewrite of one structural segment. Prove that flows back into a
// coherent body — the whole thing still round-trips and re-scans to the same
// segment kinds, and neighboring blocks are untouched.
describe('structural segment edits integrate with the scanner', () => {
  // Mirror RichBodyEditor.renderStructural: a structural segment can hold
  // several adjacent blocks, so split on annotation boundaries (join('') is
  // lossless) and edit only the matching block part.
  const applyToStructural = (
    body: string,
    match: string,
    edit: (blockPart: string) => string
  ): string => {
    const segs = scanBodySegments(body)
    const idx = segs.findIndex((s) => s.kind === 'structural' && s.text.includes(match))
    expect(idx).toBeGreaterThanOrEqual(0)
    const parts = segs[idx].text.split(/(?=<!--\s*block:)/g)
    const pi = parts.findIndex((p) => p.includes(match))
    const nextText = parts.map((p, i) => (i === pi ? edit(p) : p)).join('')
    const next = segs.map((s, i) => (i === idx ? { ...s, text: nextText } : s))
    return serializeBodySegments(next)
  }

  it('renaming a feature-grid card keeps the body coherent and siblings intact', () => {
    const next = applyToStructural(BODY, 'Tax Prep', (segText) =>
      setCardTitle(segText, 0, 'Tax Preparation')
    )
    expect(next).toContain('### Tax Preparation')
    expect(next).not.toContain('### Tax Prep\n')
    // Re-scans losslessly and to the same kind layout.
    expect(serializeBodySegments(scanBodySegments(next))).toBe(next)
    const before = scanBodySegments(BODY).map((s) => s.kind)
    expect(scanBodySegments(next).map((s) => s.kind)).toEqual(before)
    // Neighboring structural + prose content survives.
    expect(next).toContain('photo: ron.jpg')
    expect(next).toContain('More prose describing the firm.')
  })

  it('adding a card grows the feature-grid without corrupting the next block', () => {
    const next = applyToStructural(BODY, 'Tax Prep', (segText) => addCard(segText))
    expect(next).toContain('### New item')
    expect(serializeBodySegments(scanBodySegments(next))).toBe(next)
    // The team-grid annotation that trailed the feature-grid segment survives.
    expect(next).toContain('<!-- block: team-grid | variant: 3-col -->')
  })
})

describe('splitProseParts / joinProseParts', () => {
  it('preserves leading and trailing blank-line padding', () => {
    const text = '\n## Heading\n\nBody.\n'
    const parts = splitProseParts(text)
    expect(parts.core).toBe('## Heading\n\nBody.')
    expect(joinProseParts(parts, parts.core)).toBe(text)
  })

  it('treats a blank-only segment as empty core', () => {
    const parts = splitProseParts('\n\n')
    expect(parts.core).toBe('')
    expect(joinProseParts(parts, '')).toBe('\n\n')
  })
})
