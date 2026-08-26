import { describe, expect, it } from 'vitest'
import {
  cardBlockId,
  parseCardBlock,
  setCardTitle,
  setCardDescription,
  setCardLink,
  setCardIcon,
  addCard,
  removeCard,
  moveCard,
} from './card-blocks'

const SERVICE = [
  '<!-- block: service-cards | variant: 3-col -->',
  '## Our Services',
  '',
  '### Bookkeeping',
  'icon: Calculator',
  '',
  'Monthly bookkeeping and reconciliation for growing firms.',
  '[Learn more](/services/bookkeeping)',
  '',
  '### Tax Planning',
  'icon: FileText',
  '',
  'Proactive tax strategy to lower your bill.',
].join('\n')

const FEATURE = [
  '<!-- block: feature-grid | variant: 3-col -->',
  "## What's Included",
  '',
  '- Calculator: **Monthly reporting** — Clear numbers every month.',
  '- TrendingUp: **Forecasting** — Plan ahead with confidence.',
].join('\n')

describe('cardBlockId', () => {
  it('recognizes the three card families and rejects others', () => {
    expect(cardBlockId(SERVICE)).toBe('service-cards')
    expect(cardBlockId(FEATURE)).toBe('feature-grid')
    expect(cardBlockId('<!-- block: team-grid -->\n## Team')).toBeNull()
    expect(cardBlockId('## Just a heading')).toBeNull()
  })
})

describe('parseCardBlock', () => {
  it('parses chunk cards with icon, description, and trailing CTA', () => {
    const model = parseCardBlock(SERVICE)
    expect(model.blockId).toBe('service-cards')
    expect(model.heading).toBe('Our Services')
    expect(model.cards).toHaveLength(2)
    expect(model.cards[0]).toMatchObject({
      kind: 'chunk',
      title: 'Bookkeeping',
      icon: 'Calculator',
      description: 'Monthly bookkeeping and reconciliation for growing firms.',
      link: { label: 'Learn more', url: '/services/bookkeeping' },
    })
    expect(model.cards[1]).toMatchObject({ title: 'Tax Planning', icon: 'FileText', link: null })
  })

  it('parses bullet cards with inline icon/title/description', () => {
    const model = parseCardBlock(FEATURE)
    expect(model.cards).toHaveLength(2)
    expect(model.cards[0]).toMatchObject({
      kind: 'bullet',
      icon: 'Calculator',
      title: 'Monthly reporting',
      description: 'Clear numbers every month.',
    })
  })
})

describe('field edits are byte-surgical', () => {
  it('setCardTitle rewrites only the heading (chunk)', () => {
    const next = setCardTitle(SERVICE, 0, 'Bookkeeping & Payroll')
    expect(next).toBe(SERVICE.replace('### Bookkeeping', '### Bookkeeping & Payroll'))
  })

  it('setCardTitle rewrites the bullet line preserving icon and separator', () => {
    const next = setCardTitle(FEATURE, 0, 'Monthly close')
    expect(next).toContain('- Calculator: **Monthly close** — Clear numbers every month.')
    expect(next).toContain('- TrendingUp: **Forecasting**')
  })

  it('setCardDescription replaces the prose region only (chunk)', () => {
    const next = setCardDescription(SERVICE, 0, 'Full-service monthly bookkeeping.')
    expect(next).toContain('### Bookkeeping\nicon: Calculator\n\nFull-service monthly bookkeeping.\n[Learn more](/services/bookkeeping)')
    expect(next).toContain('Proactive tax strategy to lower your bill.')
  })

  it('setCardDescription collapses newlines for bullet cards', () => {
    const next = setCardDescription(FEATURE, 1, 'Plan ahead.\nWith data.')
    expect(next).toContain('- TrendingUp: **Forecasting** — Plan ahead. With data.')
  })

  it('setCardIcon inserts when missing and replaces when present', () => {
    const replaced = setCardIcon(SERVICE, 0, 'Wallet')
    expect(replaced).toContain('### Bookkeeping\nicon: Wallet')
    const noIcon = ['<!-- block: service-cards -->', '## Svc', '', '### A', '', 'Body.'].join('\n')
    expect(setCardIcon(noIcon, 0, 'Star')).toContain('### A\nicon: Star')
  })

  it('setCardLink adds, updates, and removes the trailing CTA', () => {
    const added = setCardLink(SERVICE, 1, { label: 'See details', url: '/tax' })
    expect(added).toContain('Proactive tax strategy to lower your bill.\n\n[See details](/tax)')
    const updated = setCardLink(SERVICE, 0, { label: 'Go', url: '/bk' })
    expect(updated).toContain('[Go](/bk)')
    expect(updated).not.toContain('[Learn more]')
    const removed = setCardLink(SERVICE, 0, null)
    expect(removed).not.toContain('[Learn more]')
  })
})

describe('structural ops preserve siblings', () => {
  it('addCard appends a chunk card in chunk blocks', () => {
    const next = addCard(SERVICE)
    expect(next).toContain('### New item\nicon: CheckCircle\n\nDescribe this item.')
    expect(parseCardBlock(next).cards).toHaveLength(3)
  })

  it('addCard appends a bullet in bullet blocks', () => {
    const next = addCard(FEATURE)
    expect(next).toContain('- CheckCircle: **New item** — Describe this item.')
    expect(parseCardBlock(next).cards).toHaveLength(3)
  })

  it('removeCard deletes the whole card span', () => {
    const next = removeCard(SERVICE, 0)
    expect(next).not.toContain('Bookkeeping')
    expect(next).toContain('### Tax Planning')
    expect(parseCardBlock(next).cards).toHaveLength(1)
  })

  it('moveCard swaps adjacent cards', () => {
    const next = moveCard(SERVICE, 0, 'down')
    const titles = parseCardBlock(next).cards.map((c) => c.title)
    expect(titles).toEqual(['Tax Planning', 'Bookkeeping'])
  })
})

describe('never throws on drift', () => {
  it('returns input unchanged for an out-of-range index', () => {
    expect(setCardTitle(SERVICE, 99, 'x')).toBe(SERVICE)
    expect(removeCard(SERVICE, 99)).toBe(SERVICE)
    expect(moveCard(SERVICE, 0, 'up')).toBe(SERVICE)
    expect(setCardIcon(SERVICE, 99, 'Star')).toBe(SERVICE)
  })
})
