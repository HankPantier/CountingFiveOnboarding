// Splits a page body into an ordered list of segments so the content editor can
// offer a single-screen WYSIWYG over the *prose* while leaving every piece of
// load-bearing structure byte-identical.
//
// The page body produced by lib/content/deliverable-builder.ts is NOT free-form
// markdown — it is a strict, line-addressed format the client-repo template
// parser depends on: `<!-- block: … -->` annotations, `icon:`/`photo:` lines,
// icon bullets, team-grid cards, faq-accordion Q&A, and bare-filename images.
// The Media/SEO panels mutate that structure as raw strings. A full-document
// markdown WYSIWYG would reflow and corrupt it. So we classify each line as
// `structural` (verbatim, read-only) or `prose` (safe to edit as markdown) and
// only ever hand prose to the rich editor.
//
// Round-trip guarantee: serializeBodySegments(scanBodySegments(body)) === body
// for any input (it is a pure split/join on '\n').

export type BodySegment = {
  kind: 'prose' | 'structural'
  /** The segment's lines joined by '\n'. */
  text: string
}

// Blocks whose entire body is structured data the template parses positionally.
// Everything inside them is read-only; edit via the raw-source toggle if needed.
const STRUCTURAL_BLOCKS = new Set([
  'team-grid',
  'faq-accordion',
  'feature-grid',
  'industry-cards',
  'service-cards',
])

const ANNOTATION_RE = /^\s*<!--\s*block:\s*([a-z0-9][a-z0-9-]*)/
const HTML_COMMENT_RE = /^\s*<!--/
// Mirrors the shapes the editor's structural helpers key off of.
const ICON_LINE_RE = /^icon:\s*[A-Za-z][A-Za-z0-9]*\s*$/
const PHOTO_LINE_RE = /^photo:\s*/
const ICON_BULLET_RE = /^\s*[-*]\s+(?:[A-Za-z][A-Za-z0-9]*:\s+)?\*\*(.+?)\*\*\s*(?:—|–|--)/
// A markdown image anywhere on the line — TipTap's StarterKit has no image node,
// so any line carrying one must stay structural or the image would be dropped.
const INLINE_IMAGE_RE = /!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/
// A GFM table row/separator. StarterKit has no table node either.
const TABLE_LINE_RE = /(^\s*\|)|(\|\s*$)|(\s\|\s)/

// True when a line must be preserved verbatim rather than edited as prose.
function isStructuralLine(line: string, currentBlock: string | null): boolean {
  if (HTML_COMMENT_RE.test(line)) return true
  if (currentBlock && STRUCTURAL_BLOCKS.has(currentBlock)) return true
  if (ICON_LINE_RE.test(line)) return true
  if (PHOTO_LINE_RE.test(line)) return true
  if (ICON_BULLET_RE.test(line)) return true
  if (INLINE_IMAGE_RE.test(line)) return true
  if (line.includes('|') && TABLE_LINE_RE.test(line)) return true
  return false
}

// Group consecutive same-kind lines into segments. `currentBlock` tracks the
// most recent `<!-- block: … -->` so lines inside a structural block inherit
// its read-only status.
export function scanBodySegments(body: string): BodySegment[] {
  const lines = body.split('\n')
  const segments: BodySegment[] = []
  let currentBlock: string | null = null
  let bufKind: BodySegment['kind'] | null = null
  let buf: string[] = []

  const flush = () => {
    if (bufKind !== null) segments.push({ kind: bufKind, text: buf.join('\n') })
    buf = []
  }

  for (const line of lines) {
    const annotation = line.match(ANNOTATION_RE)
    if (annotation) currentBlock = annotation[1]
    const kind: BodySegment['kind'] = isStructuralLine(line, currentBlock) ? 'structural' : 'prose'
    if (kind !== bufKind) {
      flush()
      bufKind = kind
    }
    buf.push(line)
  }
  flush()
  return segments
}

// Reassemble segments into a body string. Inverse of scanBodySegments.
export function serializeBodySegments(segments: BodySegment[]): string {
  return segments.map((s) => s.text).join('\n')
}

export type ProseParts = {
  /** Leading blank lines, verbatim (spacing before the first block). */
  leading: string[]
  /** The editable markdown core (blank-trimmed), or '' when the segment is blank-only. */
  core: string
  /** Trailing blank lines, verbatim (spacing before the next block). */
  trailing: string[]
}

// Peel the blank-line padding off a prose segment so only real content goes
// through the markdown editor; the padding is re-attached on serialize to keep
// inter-block spacing intact.
export function splitProseParts(text: string): ProseParts {
  const lines = text.split('\n')
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return {
    leading: lines.slice(0, start),
    core: lines.slice(start, end).join('\n'),
    trailing: lines.slice(end),
  }
}

// Rebuild a prose segment's text from an edited core, restoring its original
// blank-line padding.
export function joinProseParts(parts: ProseParts, core: string): string {
  const coreLines = core === '' ? [] : core.split('\n')
  return [...parts.leading, ...coreLines, ...parts.trailing].join('\n')
}
