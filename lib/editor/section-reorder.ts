// Whole-section (block) reordering for the content editor's outline panel.
// Operates on the page body via the round-trip-safe splitSections/joinSections
// (markdown-sections.ts): a section = a `<!-- block: X -->` annotation + its
// `## heading` and body up to the next annotation. Reorder/delete are pure
// array ops on that list, so an untouched section stays byte-identical and the
// live page (rendered in source order by the template) reorders with it.
//
// Indices in the public API are positions in the MOVABLE list — every annotated
// section, excluding the optional lead-in (prose before the first annotation),
// which is pinned first and never moved or deleted. All functions never throw;
// an out-of-range index returns the body unchanged.

import { splitSections, joinSections, type Section } from './markdown-sections'

export type SectionInfo = {
  /** Stable-within-a-render id for dnd/React keys (positional among movable sections). */
  id: string
  blockId: string
  variant: string
  /** The section's `## heading` text, or '' when it has none. */
  heading: string
}

export type SectionOutline = {
  /** Prose before the first block annotation, if any — pinned, not reorderable. */
  leadIn: { heading: string } | null
  /** Every annotated section, in order. Panel indices are into this array. */
  sections: SectionInfo[]
}

// Friendly labels for the outline; unknown ids fall back to the raw id.
const BLOCK_LABELS: Record<string, string> = {
  'intro-text': 'Intro text',
  'content-split': 'Text + image',
  'content-prose': 'Text',
  'checklist-section': 'Checklist',
  'process-steps': 'Process steps',
  'feature-grid': 'Feature grid',
  'service-cards': 'Services',
  'content-cards': 'Content cards',
  'team-grid': 'Team',
  'industry-cards': 'Industries',
  testimonials: 'Testimonials',
  'stats-bar': 'Stats',
  'logo-bar': 'Logos',
  'cta-banner': 'Call to action',
  pricing: 'Pricing',
  'faq-accordion': 'FAQ',
  form: 'Form',
  'content-table': 'Table',
}

export function blockLabel(blockId: string): string {
  return BLOCK_LABELS[blockId] ?? blockId
}

function extractHeading(sectionBody: string): string {
  const h = sectionBody.match(/^#{1,3}\s+(.+?)\s*$/m)
  if (h) return h[1].trim()
  const firstLine = sectionBody.split('\n').find((l) => l.trim() !== '')
  return firstLine ? firstLine.trim() : ''
}

function isLeadIn(section: Section): boolean {
  return section.annotation === ''
}

// Split into an optional pinned lead-in and the movable (annotated) sections.
function partition(body: string): { leadIn: Section | null; movable: Section[] } {
  const all = splitSections(body)
  if (all.length > 0 && isLeadIn(all[0])) {
    return { leadIn: all[0], movable: all.slice(1) }
  }
  return { leadIn: null, movable: all }
}

export function describeSections(body: string): SectionOutline {
  const { leadIn, movable } = partition(body)
  return {
    leadIn: leadIn ? { heading: extractHeading(leadIn.body) || 'Intro' } : null,
    sections: movable.map((s, i) => ({
      id: String(i),
      blockId: s.blockId,
      variant: s.variant,
      heading: extractHeading(s.body),
    })),
  }
}

function rebuild(leadIn: Section | null, movable: Section[]): string {
  return joinSections(leadIn ? [leadIn, ...movable] : movable)
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function reorderSections(body: string, from: number, to: number): string {
  const { leadIn, movable } = partition(body)
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= movable.length ||
    to >= movable.length
  )
    return body
  return rebuild(leadIn, arrayMove(movable, from, to))
}

export function moveSection(body: string, index: number, dir: 'up' | 'down'): string {
  return reorderSections(body, index, dir === 'up' ? index - 1 : index + 1)
}

export function removeSection(body: string, index: number): string {
  const { leadIn, movable } = partition(body)
  if (index < 0 || index >= movable.length) return body
  return rebuild(
    leadIn,
    movable.filter((_, i) => i !== index)
  )
}
