// The one codec for `<!-- block: … -->` annotation comments. Every editor
// helper that reads or rewrites an annotation goes through here, so the
// platform can't drift from the template's grammar again.
//
// The template parser (parse-page-md.ts SECTION_PATTERN) accepts exactly:
//
//   <!-- block: <id> | variant: <v> | image: <file> | alt: "<a>" | query: "<q>" | theme: <t> -->
//
// every field optional, in that fixed order (ANNOTATION_FIELD_ORDER in the
// block catalog contract), followed by a `## heading` line. Anything else is
// not rendered as a section. parseBlockComment reads the strict grammar first
// and falls back to a lenient read (any order, extra spaces, unknown keys
// ignored) marked `strict: false`, so the editor can still show — and refuse
// to rewrite — a hand-mangled annotation. serializeBlockComment always writes
// the canonical form; a strict line in canonical spacing round-trips byte for
// byte. Never add annotation fields here without a template release.

import { ANNOTATION_FIELD_ORDER } from '@/lib/content/block-catalog'

export type BlockComment = {
  blockId: string
  variant?: string
  image?: string
  alt?: string
  query?: string
  theme?: string
}

export type ParsedBlockComment = BlockComment & {
  /** True when the comment matches the template parser's grammar exactly. */
  strict: boolean
}

type Field = (typeof ANNOTATION_FIELD_ORDER)[number]

// The template's SECTION_PATTERN comment part (parse-page-md.ts), anchored.
const STRICT_BODY =
  '<!-- block: ([a-z-]+)(?:\\s*\\|\\s*variant:\\s*([a-z0-9-]+))?(?:\\s*\\|\\s*image:\\s*([^\\s|>]+))?(?:\\s*\\|\\s*alt:\\s*"([^"]*)")?(?:\\s*\\|\\s*query:\\s*"([^"]+)")?(?:\\s*\\|\\s*theme:\\s*([a-z]+))?\\s*-->'
const STRICT_LINE_RE = new RegExp(`^${STRICT_BODY}\\s*$`)
// ...plus the heading the template requires right after it.
const TEMPLATE_SECTION_HEAD_RE = new RegExp(`^${STRICT_BODY}\\s*\\n##\\s+(.+?)\\n`)

const LENIENT_LINE_RE = /^<!--\s*block:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*(.*?)\s*-->\s*$/
const LENIENT_FIELD_RE = /\|\s*([A-Za-z]+)\s*:\s*("([^"]*)"|[^|]*)/g
const FIELDS = new Set<string>(ANNOTATION_FIELD_ORDER)

function strictFields(m: RegExpMatchArray): BlockComment {
  const out: BlockComment = { blockId: m[1] }
  ANNOTATION_FIELD_ORDER.forEach((field, i) => {
    const value = m[i + 2]
    if (value !== undefined) out[field] = value
  })
  return out
}

/**
 * Parse one annotation line. Returns null when the line is not a block
 * comment at all (e.g. no closing `-->`).
 */
export function parseBlockComment(line: string): ParsedBlockComment | null {
  const strict = line.match(STRICT_LINE_RE)
  if (strict) return { ...strictFields(strict), strict: true }
  const loose = line.match(LENIENT_LINE_RE)
  if (!loose) return null
  const out: ParsedBlockComment = { blockId: loose[1].toLowerCase(), strict: false }
  for (const f of loose[2].matchAll(LENIENT_FIELD_RE)) {
    const key = f[1].toLowerCase()
    if (!FIELDS.has(key) || out[key as Field] !== undefined) continue
    const value = (f[3] ?? f[2]).trim()
    if (value !== '') out[key as Field] = value
  }
  return out
}

/** Canonical annotation line (template field order, single spaces). */
export function serializeBlockComment(c: BlockComment): string {
  let out = `<!-- block: ${c.blockId}`
  for (const field of ANNOTATION_FIELD_ORDER) {
    const raw = c[field]
    if (raw === undefined || raw === null) continue
    if (field === 'alt' || field === 'query') {
      const value = raw.replace(/"/g, '')
      // The template requires a non-empty query ("[^"]+"); alt may be empty.
      if (field === 'query' && value === '') continue
      out += ` | ${field}: "${value}"`
    } else if (raw !== '') {
      out += ` | ${field}: ${raw}`
    }
  }
  return `${out} -->`
}

/**
 * True when the template parser renders this annotation + following text as a
 * section: the comment is strict AND a `## heading` line follows (optionally
 * after blank lines). A heading-less ("stray") annotation is not rendered.
 */
export function rendersAsSection(annotationLine: string, bodyAfter: string): boolean {
  return TEMPLATE_SECTION_HEAD_RE.test(`${annotationLine}\n${bodyAfter}`)
}
