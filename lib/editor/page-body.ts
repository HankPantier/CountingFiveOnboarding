import type { FaqItem } from './structured-fields'
import { findTrailerStart, foreignHeadings } from '@/lib/content/strip-generator-notes'
import { humanizeDashes } from '@/lib/content/anti-slop-validator'
import { splitFile } from './frontmatter'
import { parseBlockComment } from './block-annotation'

// The generator appends two trailers to the page body that the template strips
// at render (parse-page-md.ts `trimMetadataTrailer`): a human-readable
// `## SEO & AIO Metadata` block and a `## Structured Data — paste into <head>`
// fenced JSON-LD block. They render nothing live, so the editor splits them out
// of the editable body and never shows the raw schema. We re-attach the trailer
// verbatim on save (no data loss); frontmatter is the live source of truth.
//
// The anchors live in lib/content/strip-generator-notes.ts (findTrailerStart),
// shared with the post strip and the page repair so all three agree on where
// the trailer begins.

export type SplitBody = { content: string; trailer: string }

// Split the body into editable content and the (hidden) metadata trailer. The
// trailer starts at the earliest trailer anchor and keeps the line break in
// front of it, so `content` never ends mid-line. content + trailer === body.
// When real content (any other heading) follows the trailer, nothing is
// hidden: the AI editor and PageEditor must be able to see and fix it.
export function splitTrailers(body: string): SplitBody {
  let idx = findTrailerStart(body)
  if (idx < 0) return { content: body, trailer: '' }
  if (foreignHeadings(body.slice(idx)).length > 0) return { content: body, trailer: '' }
  if (idx > 0 && body[idx - 1] === '\n') idx--
  if (idx > 0 && body[idx - 1] === '\r') idx--
  return { content: body.slice(0, idx), trailer: body.slice(idx) }
}

/**
 * Normalize em/en dashes in the reader-facing body prose ONLY. Frontmatter
 * (URLs, JSON blobs, quoted YAML) and the generator trailer stay byte-for-byte:
 * scrubbing the trailer turned "Structured Data — paste into" into a comma form
 * on Accord's /services (commit e0d81c7, via remove_text stripDashes).
 */
export function humanizeBodyDashes(file: string): string {
  const { body } = splitFile(file)
  const head = file.slice(0, file.length - body.length)
  const { content, trailer } = splitTrailers(body)
  return head + humanizeDashes(content) + trailer
}

const FAQ_MARKER = '<!-- block: faq-accordion -->'
// Any faq-accordion annotation line, whatever its fields/spacing (confirmed by
// the codec). An existing marker line is kept verbatim on rewrite.
const FAQ_MARKER_LINE_RE = /^<!--\s*block:\s*faq-accordion\b[^\n]*$/gm

function findFaqMarker(content: string): { index: number; line: string } | null {
  for (const m of content.matchAll(FAQ_MARKER_LINE_RE)) {
    const line = m[0].replace(/\r$/, '')
    if (parseBlockComment(line)?.blockId === 'faq-accordion') return { index: m.index ?? 0, line }
  }
  return null
}
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
  const marker = findFaqMarker(content)
  if (marker) {
    const markerIdx = marker.index
    const afterMarker = content.slice(markerIdx + marker.line.length)
    const nextBlock = afterMarker.search(/\n<!-- block:/)
    const sectionEnd =
      nextBlock >= 0 ? markerIdx + marker.line.length + nextBlock : content.length
    const section = content.slice(markerIdx, sectionEnd)
    const headingMatch = section.match(/##\s+(.+)/)
    const heading = headingMatch ? headingMatch[1].trim() : defaultHeading
    const before = content.slice(0, markerIdx).trimEnd()
    const after = content.slice(sectionEnd).replace(/^\s+/, '')
    if (items.length === 0) {
      return [before, after].filter((s) => s !== '').join('\n\n')
    }
    const newSection = `${marker.line}\n## ${heading}\n\n${faqProse(items)}`
    return [before, newSection, after].filter((s) => s !== '').join('\n\n')
  }
  if (items.length === 0) return content
  const newSection = `${FAQ_MARKER}\n## ${defaultHeading}\n\n${faqProse(items)}`
  return `${content.trimEnd()}\n\n${newSection}\n`
}
