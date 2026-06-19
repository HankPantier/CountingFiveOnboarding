import type { FaqItem } from './structured-fields'

// The generator appends two trailers to the page body that the template strips
// at render (parse-page-md.ts `trimMetadataTrailer`): a human-readable
// `## SEO & AIO Metadata` block and a `## Structured Data — paste into <head>`
// fenced JSON-LD block. They render nothing live, so the editor splits them out
// of the editable body and never shows the raw schema. We re-attach the trailer
// verbatim on save (no data loss); frontmatter is the live source of truth.
const SEO_TRAILER_RE = /\n---\n##\s+SEO\s*&(?:amp;)?\s*AIO Metadata\b/i
const STRUCTURED_TRAILER_RE = /\n---\n##\s+Structured Data\b/i

export type SplitBody = { content: string; trailer: string }

// Split the body into editable content and the (hidden) metadata trailer. The
// trailer starts at the earliest trailer marker. content + trailer === body.
export function splitTrailers(body: string): SplitBody {
  let idx = -1
  for (const re of [SEO_TRAILER_RE, STRUCTURED_TRAILER_RE]) {
    const m = re.exec(body)
    if (m && (idx < 0 || m.index < idx)) idx = m.index
  }
  if (idx < 0) return { content: body, trailer: '' }
  return { content: body.slice(0, idx), trailer: body.slice(idx) }
}

const FAQ_MARKER = '<!-- block: faq-accordion -->'
// Same Q&A shape the template parses (md-utils.ts `parseFaqList`).
const FAQ_PAIR_RE = /\*\*Q:\s*(.+?)\*\*\s*\nA:\s*([\s\S]+?)(?=\n\*\*Q:|$)/g

// Parse `**Q: ...**\nA: ...` pairs from a body (the faq-accordion prose). Used
// to seed the FAQ editor when a legacy page has no frontmatter faq_block.
export function parseFaqFromBody(body: string): FaqItem[] {
  const items: FaqItem[] = []
  let m: RegExpExecArray | null
  FAQ_PAIR_RE.lastIndex = 0
  while ((m = FAQ_PAIR_RE.exec(body)) !== null) {
    items.push({ question: m[1].trim(), answer: m[2].trim() })
  }
  return items
}

function faqProse(items: FaqItem[]): string {
  return items.map((f) => `**Q: ${f.question}**\nA: ${f.answer}`).join('\n\n')
}

// Keep the on-page faq-accordion block in sync with the FAQ items so the editor
// body never shows stale Q&A. Preserves the existing heading and marker (the
// template needs the marker for on-page placement; it reads items from
// frontmatter). Empty items remove the block; new items append one if absent.
export function setFaqAccordionBody(
  content: string,
  items: FaqItem[],
  defaultHeading: string
): string {
  const markerIdx = content.indexOf(FAQ_MARKER)
  if (markerIdx >= 0) {
    const afterMarker = content.slice(markerIdx + FAQ_MARKER.length)
    const nextBlock = afterMarker.search(/\n<!-- block:/)
    const sectionEnd =
      nextBlock >= 0 ? markerIdx + FAQ_MARKER.length + nextBlock : content.length
    const section = content.slice(markerIdx, sectionEnd)
    const headingMatch = section.match(/##\s+(.+)/)
    const heading = headingMatch ? headingMatch[1].trim() : defaultHeading
    const before = content.slice(0, markerIdx).trimEnd()
    const after = content.slice(sectionEnd).replace(/^\s+/, '')
    if (items.length === 0) {
      return [before, after].filter((s) => s !== '').join('\n\n')
    }
    const newSection = `${FAQ_MARKER}\n## ${heading}\n\n${faqProse(items)}`
    return [before, newSection, after].filter((s) => s !== '').join('\n\n')
  }
  if (items.length === 0) return content
  const newSection = `${FAQ_MARKER}\n## ${defaultHeading}\n\n${faqProse(items)}`
  return `${content.trimEnd()}\n\n${newSection}\n`
}
