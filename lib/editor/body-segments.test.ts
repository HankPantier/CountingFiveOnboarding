import { describe, expect, it } from 'vitest'
import {
  scanBodySegments,
  serializeBodySegments,
  splitProseParts,
  joinProseParts,
} from './body-segments'

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
