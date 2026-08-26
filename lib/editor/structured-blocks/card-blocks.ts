// Inline field editing for the three card families — feature-grid,
// service-cards, industry-cards. Operates on a SINGLE block's text (the part
// splitBlocks() yields: `<!-- block: … -->` + `## heading` + items + trailing
// blanks, with no following annotation). Every mutation is a byte-surgical
// line rewrite that leaves the annotation, the `## heading`, card images, and
// unedited siblings untouched — mirroring team-photos.ts / icon-items.ts. All
// functions are pure and never throw; on any drift between a stale index and
// the current text they return the input unchanged rather than corrupt it.
//
// Two item syntaxes are recognized, matching the template parsers
// (md-utils.ts parseIconTitleDescriptionList / parseH3CardList):
//   bullet: `- IconName: **Title** — Description`
//   chunk:  `### Title` / optional `icon: Name` / description / optional [cta](url)
// The item's original syntax is preserved on edit; added cards default to chunk.

import { extractIconItems, setItemIcon } from '../icon-items'
import type { CardBlockModel, CardKind, CardModel } from './types'

const ANNOTATION_RE = /^<!--\s*block:\s*([a-z0-9][a-z0-9-]*)/
const H2_RE = /^##\s+(.+?)\s*$/
const CARD_HEADING_RE = /^###\s+(.+?)\s*$/
const BOLD_LINE_RE = /^\*\*([^*\n][^*\n]*[^*\n\s])\*\*\s*$/
// Capture prefix / icon / title / separator / description so title & description
// can be rewritten while preserving the icon and the original dash style.
const BULLET_RE = /^(\s*[-*]\s+)(?:([A-Za-z][A-Za-z0-9]*):\s+)?\*\*(.+?)\*\*\s*(—|–|--)\s*(.*)$/
const ICON_LINE_RE = /^icon:\s*([A-Za-z][A-Za-z0-9]*)\s*$/
const PHOTO_LINE_RE = /^\s*photo:\s*\S/
const IMAGE_LINE_RE = /^\s*!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/
const CTA_LINE_RE = /^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/

const CARD_BLOCK_IDS = new Set(['feature-grid', 'service-cards', 'industry-cards'])

/** The block id if this text is one of the three card families, else null. */
export function cardBlockId(block: string): CardBlockModel['blockId'] | null {
  const id = block.split('\n', 1)[0].match(ANNOTATION_RE)?.[1]
  return id && CARD_BLOCK_IDS.has(id) ? (id as CardBlockModel['blockId']) : null
}

type CardSpan = {
  index: number
  kind: CardKind
  /** First line of the card (heading for chunk, the bullet line for bullet). */
  startLine: number
  /** Exclusive end — up to the next card start or block end (trailing blanks travel with the card). */
  endLine: number
  headingForm: 'h3' | 'bold' | 'bullet'
  title: string
  icon: string | null
  /** Prose region [start, end) to replace on description edit; equal bounds = empty. */
  descStart: number
  descEnd: number
  description: string
  /** Trailing CTA line index, or null. */
  linkLine: number | null
  link: { label: string; url: string } | null
  /** For bullet cards, the parsed pieces needed to re-emit the single line. */
  bullet?: { prefix: string; icon: string | null; sep: string }
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

// Parse every card in a single card-block's text, with line spans for rewriting.
function scanCards(lines: string[]): { kind: CardKind; cards: CardSpan[] } {
  const bulletLines: number[] = []
  const chunkStarts: number[] = []
  for (let i = 1; i < lines.length; i++) {
    if (BULLET_RE.test(lines[i])) bulletLines.push(i)
    else if (CARD_HEADING_RE.test(lines[i]) || BOLD_LINE_RE.test(lines[i])) chunkStarts.push(i)
  }

  // A block is uniformly bullets or chunks; bullets win when both somehow appear.
  if (bulletLines.length > 0) {
    const cards = bulletLines.map((start, idx) => {
      const end = idx + 1 < bulletLines.length ? bulletLines[idx + 1] : lines.length
      const m = lines[start].match(BULLET_RE)!
      return {
        index: idx,
        kind: 'bullet' as const,
        startLine: start,
        endLine: end,
        headingForm: 'bullet' as const,
        title: m[3].trim(),
        icon: m[2] ?? null,
        descStart: start,
        descEnd: start,
        description: m[5].trim(),
        linkLine: null,
        link: null,
        bullet: { prefix: m[1], icon: m[2] ?? null, sep: m[4] },
      }
    })
    return { kind: 'bullet', cards }
  }

  const cards: CardSpan[] = chunkStarts.map((start, idx) => {
    const end = idx + 1 < chunkStarts.length ? chunkStarts[idx + 1] : lines.length
    const h3 = lines[start].match(CARD_HEADING_RE)
    const title = (h3 ? h3[1] : lines[start].match(BOLD_LINE_RE)![1]).trim()

    // First non-blank line after the heading may be an `icon:` line.
    let cursor = start + 1
    while (cursor < end && isBlank(lines[cursor])) cursor++
    let icon: string | null = null
    const iconMatch = cursor < end ? lines[cursor].match(ICON_LINE_RE) : null
    if (iconMatch) {
      icon = iconMatch[1]
      cursor++
    }

    // Trailing CTA: the last non-blank line in the span, if it is a lone link.
    let tail = end
    while (tail > cursor && isBlank(lines[tail - 1])) tail--
    let linkLine: number | null = null
    let link: { label: string; url: string } | null = null
    if (tail > cursor) {
      const cta = lines[tail - 1].match(CTA_LINE_RE)
      if (cta) {
        linkLine = tail - 1
        link = { label: cta[1].trim(), url: cta[2].trim() }
        tail--
      }
    }

    // Description = prose between the leading metadata and the trailing CTA,
    // skipping a leading photo:/image line and surrounding blanks.
    let descStart = cursor
    while (
      descStart < tail &&
      (isBlank(lines[descStart]) || PHOTO_LINE_RE.test(lines[descStart]) || IMAGE_LINE_RE.test(lines[descStart]))
    )
      descStart++
    let descEnd = tail
    while (descEnd > descStart && isBlank(lines[descEnd - 1])) descEnd--
    const description = lines.slice(descStart, descEnd).join('\n').trim()

    return {
      index: idx,
      kind: 'chunk' as const,
      startLine: start,
      endLine: end,
      headingForm: h3 ? ('h3' as const) : ('bold' as const),
      title,
      icon,
      descStart,
      descEnd,
      description,
      linkLine,
      link,
    }
  })
  return { kind: 'chunk', cards }
}

/** Field view of a single card block for rendering. */
export function parseCardBlock(block: string): CardBlockModel {
  const id = cardBlockId(block)
  const lines = block.split('\n')
  const heading = lines.find((l) => H2_RE.test(l))?.match(H2_RE)?.[1]?.trim() ?? ''
  const { cards } = scanCards(lines)
  const models: CardModel[] = cards.map((c) => ({
    index: c.index,
    kind: c.kind,
    title: c.title,
    description: c.description,
    icon: c.icon,
    link: c.link,
  }))
  return { blockId: id ?? 'feature-grid', heading, cards: models }
}

function rewrite(
  block: string,
  index: number,
  fn: (lines: string[], card: CardSpan, all: CardSpan[]) => string[] | null
): string {
  const lines = block.split('\n')
  const { cards } = scanCards(lines)
  const card = cards[index]
  if (!card) return block
  const next = fn(lines, card, cards)
  return next === null ? block : next.join('\n')
}

export function setCardTitle(block: string, index: number, value: string): string {
  const title = value.trim()
  return rewrite(block, index, (lines, card) => {
    const next = [...lines]
    if (card.kind === 'bullet') {
      const b = card.bullet!
      const iconPart = b.icon ? `${b.icon}: ` : ''
      next[card.startLine] = `${b.prefix}${iconPart}**${title}** ${b.sep} ${card.description}`
    } else if (card.headingForm === 'h3') {
      next[card.startLine] = `### ${title}`
    } else {
      next[card.startLine] = `**${title}**`
    }
    return next
  })
}

export function setCardDescription(block: string, index: number, value: string): string {
  return rewrite(block, index, (lines, card) => {
    const next = [...lines]
    if (card.kind === 'bullet') {
      const b = card.bullet!
      const iconPart = b.icon ? `${b.icon}: ` : ''
      const desc = value.trim().replace(/\n+/g, ' ')
      next[card.startLine] = `${b.prefix}${iconPart}**${card.title}** ${b.sep} ${desc}`
      return next
    }
    const descLines = value.trim() === '' ? [] : value.trim().split('\n')
    next.splice(card.descStart, card.descEnd - card.descStart, ...descLines)
    return next
  })
}

export function setCardLink(
  block: string,
  index: number,
  link: { label: string; url: string } | null
): string {
  return rewrite(block, index, (lines, card) => {
    if (card.kind === 'bullet') return null // bullets carry no CTA
    const next = [...lines]
    const label = link?.label.trim() ?? ''
    const url = link?.url.trim() ?? ''
    if (card.linkLine !== null) {
      if (label && url) next[card.linkLine] = `[${label}](${url})`
      else next.splice(card.linkLine, 1) // clearing removes the line
      return next
    }
    if (!label || !url) return null
    // Insert after the last non-blank line of the card span.
    let tail = card.endLine
    while (tail > card.startLine && isBlank(next[tail - 1])) tail--
    next.splice(tail, 0, '', `[${label}](${url})`)
    return next
  })
}

// Icon rewrites reuse the tested icon-items helpers so both syntaxes and the
// insert-when-missing case stay in one place. Refs come from the SAME text.
export function setCardIcon(block: string, index: number, icon: string): string {
  const refs = extractIconItems(block)
  const ref = refs[index]
  if (!ref) return block
  return setItemIcon(block, ref, icon)
}

function dropTrailingBlanks(lines: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop()
  return out
}

export function addCard(block: string, kindHint?: CardKind): string {
  const lines = block.split('\n')
  const { kind } = scanCards(lines)
  const effective = kindHint ?? kind
  const body = dropTrailingBlanks(lines)
  const newLines =
    effective === 'bullet'
      ? ['- CheckCircle: **New item** — Describe this item.']
      : ['### New item', 'icon: CheckCircle', '', 'Describe this item.']
  return [...body, '', ...newLines, ''].join('\n')
}

export function removeCard(block: string, index: number): string {
  return rewrite(block, index, (lines, card) => {
    const next = [...lines]
    next.splice(card.startLine, card.endLine - card.startLine)
    return next
  })
}

export function moveCard(block: string, index: number, dir: 'up' | 'down'): string {
  return rewrite(block, index, (lines, card, all) => {
    const j = dir === 'up' ? index - 1 : index + 1
    if (!all[index] || !all[j]) return null
    const a = all[Math.min(index, j)]
    const b = all[Math.max(index, j)]
    return [
      ...lines.slice(0, a.startLine),
      ...lines.slice(b.startLine, b.endLine),
      ...lines.slice(a.startLine, a.endLine),
      ...lines.slice(b.endLine),
    ]
  })
}
