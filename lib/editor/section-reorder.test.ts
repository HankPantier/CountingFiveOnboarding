import { describe, expect, it } from 'vitest'
import {
  describeSections,
  reorderSections,
  moveSection,
  removeSection,
  blockLabel,
} from './section-reorder'
import { splitSections } from './markdown-sections'

const BODY = [
  '<!-- block: intro-text | variant: centered -->',
  '## Welcome',
  '',
  'Opening prose.',
  '',
  '<!-- block: service-cards | variant: 3-col -->',
  '## Our Services',
  '',
  '### Bookkeeping',
  'icon: Calculator',
  '',
  'Monthly books.',
  '',
  '<!-- block: team-grid | variant: 3-col -->',
  '## Meet the Team',
  '',
  '### Ron Lague',
  'Ron leads the firm.',
  '',
  '<!-- block: faq-accordion -->',
  '## FAQ',
  '',
  '**Q: Do you offer payroll?**',
  'A: Yes.',
  '',
].join('\n')

// Prose before the first annotation → a pinned lead-in section.
const LEAD_IN_BODY = ['Some intro prose with no block.', '', BODY].join('\n')

const blockIds = (body: string) =>
  splitSections(body)
    .filter((s) => s.annotation !== '')
    .map((s) => s.blockId)

describe('describeSections', () => {
  it('lists movable sections with heading + block id, no lead-in', () => {
    const outline = describeSections(BODY)
    expect(outline.leadIn).toBeNull()
    expect(outline.sections.map((s) => s.blockId)).toEqual([
      'intro-text',
      'service-cards',
      'team-grid',
      'faq-accordion',
    ])
    expect(outline.sections.map((s) => s.heading)).toEqual([
      'Welcome',
      'Our Services',
      'Meet the Team',
      'FAQ',
    ])
  })

  it('pins a lead-in section separately from the movable list', () => {
    const outline = describeSections(LEAD_IN_BODY)
    expect(outline.leadIn).toEqual({ heading: 'Some intro prose with no block.' })
    expect(outline.sections).toHaveLength(4)
  })
})

describe('reorderSections / moveSection', () => {
  it('reorders sections and keeps the moved section byte-identical', () => {
    const next = reorderSections(BODY, 2, 0) // team-grid to top
    expect(blockIds(next)).toEqual(['team-grid', 'intro-text', 'service-cards', 'faq-accordion'])
    // The team-grid section content survives verbatim.
    expect(next).toContain('### Ron Lague\nRon leads the firm.')
    // Round-trips through splitSections/joinSections.
    expect(splitSections(next).map((s) => s.annotation ? s.annotation + '\n' + s.body : s.body).join('')).toBe(next)
  })

  it('moveSection up/down is a one-step swap', () => {
    expect(blockIds(moveSection(BODY, 1, 'up'))).toEqual([
      'service-cards',
      'intro-text',
      'team-grid',
      'faq-accordion',
    ])
    expect(blockIds(moveSection(BODY, 1, 'down'))).toEqual([
      'intro-text',
      'team-grid',
      'service-cards',
      'faq-accordion',
    ])
  })

  it('no-ops at the boundaries and on equal indices', () => {
    expect(moveSection(BODY, 0, 'up')).toBe(BODY)
    expect(moveSection(BODY, 3, 'down')).toBe(BODY)
    expect(reorderSections(BODY, 1, 1)).toBe(BODY)
  })

  it('never moves the pinned lead-in and keeps it first', () => {
    const next = reorderSections(LEAD_IN_BODY, 3, 0) // faq to top of movable
    expect(next.startsWith('Some intro prose with no block.')).toBe(true)
    expect(blockIds(next)).toEqual(['faq-accordion', 'intro-text', 'service-cards', 'team-grid'])
  })

  it('returns the body unchanged on out-of-range indices', () => {
    expect(reorderSections(BODY, 0, 9)).toBe(BODY)
    expect(reorderSections(BODY, 9, 0)).toBe(BODY)
    expect(moveSection(BODY, 9, 'up')).toBe(BODY)
  })
})

describe('removeSection', () => {
  it('removes exactly one section', () => {
    const next = removeSection(BODY, 1) // drop service-cards
    expect(blockIds(next)).toEqual(['intro-text', 'team-grid', 'faq-accordion'])
    expect(next).not.toContain('Our Services')
    expect(next).toContain('## Welcome')
    expect(next).toContain('## Meet the Team')
  })

  it('never removes the lead-in and no-ops out of range', () => {
    const next = removeSection(LEAD_IN_BODY, 0)
    expect(next.startsWith('Some intro prose with no block.')).toBe(true)
    expect(blockIds(next)).toEqual(['service-cards', 'team-grid', 'faq-accordion'])
    expect(removeSection(BODY, 9)).toBe(BODY)
  })
})

describe('blockLabel', () => {
  it('maps known ids and falls back to the raw id', () => {
    expect(blockLabel('service-cards')).toBe('Services')
    expect(blockLabel('faq-accordion')).toBe('FAQ')
    expect(blockLabel('mystery-block')).toBe('mystery-block')
  })
})
