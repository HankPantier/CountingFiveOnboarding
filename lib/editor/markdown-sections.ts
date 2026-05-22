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

export type Section = {
  // Verbatim annotation comment line, e.g. "<!-- block: feature-grid | variant: 3-col -->".
  // Empty string for the implicit lead-in section before the first annotation
  // (if the page does not start with an annotation).
  annotation: string
  // Parsed convenience fields. Both '' when annotation === ''.
  blockId: string
  variant: string
  // Everything after the annotation line up to (but not including) the next
  // annotation. Includes its own trailing newline(s) as they appear in source.
  // For a lead-in section, contains the whole prefix.
  body: string
}

const ANNOTATION_RE = /^<!--\s*block:\s*([a-z0-9][a-z0-9-]*)(?:\s*\|\s*variant:\s*([^\s|][^|]*?))?\s*-->\s*$/i

export function parseAnnotation(line: string): { blockId: string; variant: string } | null {
  const m = line.match(ANNOTATION_RE)
  if (!m) return null
  return { blockId: m[1].toLowerCase(), variant: (m[2] ?? '').trim() }
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
      return {
        annotation: firstLine,
        blockId: parsed.blockId,
        variant: parsed.variant,
        body: newlineIdx >= 0 ? chunk.slice(newlineIdx + 1) : '',
      }
    }
    return { annotation: '', blockId: '', variant: '', body: chunk }
  })
}

// Inverse of splitSections. Re-emits annotation + '\n' + body for each
// non-lead-in section; lead-ins emit body only.
export function joinSections(sections: Section[]): string {
  return sections
    .map((s) => (s.annotation ? s.annotation + '\n' + s.body : s.body))
    .join('')
}

export function isValidAnnotation(line: string): boolean {
  return ANNOTATION_RE.test(line)
}
