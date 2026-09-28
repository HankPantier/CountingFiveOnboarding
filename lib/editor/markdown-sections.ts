// Parser/serializer for page .md files that use the Phase II block-annotation
// convention. Each section is preceded by an HTML comment like:
//
//   <!-- block: feature-grid | variant: 3-col -->
//   ## Section Heading
//   ...body...
//
// We split the body of the page (frontmatter excluded — that lives in
// lib/editor/frontmatter.ts) into ordered sections so the editor can present
// each one independently. Round-trip is byte-identical for unedited sections.

import { parseBlockComment, rendersAsSection } from './block-annotation'

export type Section = {
  // Verbatim annotation comment line, e.g. "<!-- block: feature-grid | variant: 3-col -->".
  // Empty string for the implicit lead-in section before the first annotation
  // (if the page does not start with an annotation).
  annotation: string
  // Parsed convenience fields (via the block-annotation codec). All '' when
  // annotation === ''.
  blockId: string
  variant: string
  theme: string
  // True when the template renders this as a section: the annotation matches
  // its strict grammar and a `## heading` follows. False for a lead-in, a
  // hand-mangled annotation (parsed leniently) or a stray heading-less one —
  // callers must not rewrite those.
  parseable: boolean
  // Everything after the annotation line up to (but not including) the next
  // annotation. Includes its own trailing newline(s) as they appear in source.
  // For a lead-in section, contains the whole prefix.
  body: string
}

export function parseAnnotation(line: string): { blockId: string; variant: string; theme: string; strict: boolean } | null {
  const c = parseBlockComment(line)
  if (!c) return null
  return { blockId: c.blockId, variant: c.variant ?? '', theme: c.theme ?? '', strict: c.strict }
}

// Split a page body into sections. Uses the same lookahead-split pattern as
// lib/content/deliverable-builder.ts → injectTeamPhotos() for compatibility.
export function splitSections(body: string): Section[] {
  if (body === '') return []
  const chunks = body.split(/(?=^<!-- block:)/m).filter((c) => c.length > 0)
  return chunks.map((chunk): Section => {
    const newlineIdx = chunk.indexOf('\n')
    const firstLine = newlineIdx >= 0 ? chunk.slice(0, newlineIdx) : chunk
    const parsed = parseAnnotation(firstLine)
    if (parsed) {
      const body = newlineIdx >= 0 ? chunk.slice(newlineIdx + 1) : ''
      return {
        annotation: firstLine,
        blockId: parsed.blockId,
        variant: parsed.variant,
        theme: parsed.theme,
        parseable: parsed.strict && rendersAsSection(firstLine, body),
        body,
      }
    }
    return { annotation: '', blockId: '', variant: '', theme: '', parseable: false, body: chunk }
  })
}

// Inverse of splitSections. Re-emits annotation + '\n' + body for each
// non-lead-in section; lead-ins emit body only.
export function joinSections(sections: Section[]): string {
  return sections
    .map((s) => (s.annotation ? s.annotation + '\n' + s.body : s.body))
    .join('')
}

// True when the line is an annotation in the template's strict grammar.
export function isValidAnnotation(line: string): boolean {
  return parseBlockComment(line)?.strict === true
}
