// Generator notes that must never render on a live page.
//
// buildPageMarkdown (deliverable-builder.ts) appends a human-review trailer to
// every PAGE file after the body:
//
//   ---
//   ## SEO & AIO Metadata
//   **Answer Block:** / **E-E-A-T Signals:** / **Internal Links:** /
//   **FAQ Block:** / **LLM Citation Note:** / (**Call to Action:** …)
//   ---
//   ## Structured Data — paste into `<head>`
//   ```html <script type="application/ld+json">…</script> ```
//
// The template's page renderer (parse-page-md.ts `trimMetadataTrailer`) cuts
// the body at the "## SEO & AIO Metadata" marker and lifts the JSON-LD out of
// the Structured Data block, so on a page the trailer is invisible and useful.
// The POST renderer (blog-views.tsx) has no such trim: a page relocated into
// content/posts/ renders the whole trailer as prose + a code dump. And a page
// whose SEO marker got edited away still renders its Structured Data block.
//
// Everything here is pure and anchored on the exact shapes the generator
// emits, so a reader-facing "## FAQ" or "Related links" section is never hit.

export const GENERATOR_NOTE_LABELS = [
  'Answer Block',
  'E-E-A-T Signals',
  'Internal Links',
  'FAQ Block',
  'LLM Citation Note',
] as const

export type GeneratorNoteLabel = (typeof GENERATOR_NOTE_LABELS)[number] | 'Call to Action'

// `---` rule line, optional blank lines, then the EXACT generator heading
// (case-sensitive; `&amp;` tolerated for HTML-escaped copies). The rule is
// required so a heading that merely mentions SEO in prose never anchors a cut.
const SEO_TRAILER_RE = /(^|\r?\n)-{3,}[ \t]*\r?\n(?:[ \t]*\r?\n)*## SEO &(?:amp;)? AIO Metadata[ \t]*(?=\r?\n|$)/
// "## Structured Data — paste into `<head>`". The AI editor's dash scrub turned
// the em-dash into a comma on some pages, so the separator may vary.
const STRUCTURED_TRAILER_RE =
  /(^|\r?\n)-{3,}[ \t]*\r?\n(?:[ \t]*\r?\n)*## Structured Data ?(?:—|–|-|,|:)? ?paste into `<head>`[ \t]*(?=\r?\n|$)/

const LABEL_ALT = GENERATOR_NOTE_LABELS.map((l) => l.replace(/[-]/g, '\\-')).join('|')
// A generator label on a line of its own: `**Internal Links:**`.
const LABEL_LINE_RE = new RegExp(`^[ \\t]*\\*\\*(${LABEL_ALT}):\\*\\*[ \\t]*\\r?$`, 'gm')
const CTA_LINE_RE = /^[ \t]*\*\*Call to Action:\*\*[ \t]+\[/m

export interface ParsedGeneratorNotes {
  answerBlock: string | null
  eeatSignals: string[]
  internalLinks: Array<{ url: string; anchor_text: string; reason: string }>
  faqBlock: Array<{ question: string; answer: string }>
  llmCitationNote: string | null
}

export interface BodyStripResult {
  body: string
  /** Labels / section names that were removed, in document order, de-duped. */
  removed: string[]
  /** The exact text cut from the body ('' when nothing was cut). */
  removedText: string
  /**
   * Set when a trailer was found but NOT cut, because the text after it holds
   * a heading other than the two trailer headings (real content appended after
   * the trailer). Nothing is removed; a human has to look.
   */
  warning?: string
}

const TRAILER_HEADING_LINE_RE =
  /^## (?:SEO &(?:amp;)? AIO Metadata|Structured Data ?(?:—|–|-|,|:)? ?paste into `<head>`)[ \t]*\r?$/

const re = (r: RegExp) => ({ source: r.source, flags: r.flags })

/**
 * The trailer anchors as plain data. Byte-mirrored with the client template
 * (src/lib/content/strip-generator-notes.ts there) through
 * lib/content/__fixtures__/generator-trailer.template.json; a parity test
 * fails when either side drifts. Copy the fixture, don't retype it.
 */
export const GENERATOR_TRAILER_ANCHORS = {
  version: 1,
  labels: [...GENERATOR_NOTE_LABELS],
  seoTrailer: re(SEO_TRAILER_RE),
  structuredTrailer: re(STRUCTURED_TRAILER_RE),
  labelLine: re(LABEL_LINE_RE),
  ctaLine: re(CTA_LINE_RE),
  trailerHeadingLine: re(TRAILER_HEADING_LINE_RE),
}

// Headings in `text` other than the two trailer headings, ignoring fenced code.
// Non-empty for a trailer means real content follows it: never cut or hide it.
export function foreignHeadings(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .split(/\r?\n/)
    .filter((l) => /^#{1,6}[ \t]/.test(l) && !TRAILER_HEADING_LINE_RE.test(l))
    .map((l) => l.trim())
}

// Line ending of a file — CRLF when the file uses it, else LF.
function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function trailerStart(body: string, re: RegExp): number {
  const m = re.exec(body)
  if (!m) return -1
  // Point at the start of the `---` line (skip the captured leading newline).
  return m.index + m[1].length
}

function labelsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(LABEL_LINE_RE)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  if (CTA_LINE_RE.test(text)) out.push('Call to Action')
  return out
}

// A heading-less run of generator labels at the END of a body: the model
// echoing its metadata plan, or an SEO trailer whose "## SEO & AIO Metadata"
// line alone was deleted. Conservative: needs >=2 distinct exact labels, and
// nothing structural (a heading or a block annotation) may sit between the
// first label and the end, or the Structured Data trailer, which is allowed
// to follow. A reader-facing section always starts with a heading.
function bareLabelRunStart(body: string): number {
  const structured = trailerStart(body, STRUCTURED_TRAILER_RE)
  const limit = structured >= 0 ? structured : body.length
  const matches = [...body.matchAll(LABEL_LINE_RE)]
  for (const m of matches) {
    const start = m.index ?? 0
    if (start >= limit) break
    const tail = body.slice(start, limit)
    if (/^[ \t]*#{1,6}[ \t]/m.test(tail) || tail.includes('<!-- block:')) continue
    if (labelsIn(tail).filter((l) => l !== 'Call to Action').length < 2) return -1
    // Take a directly preceding `---` rule with it.
    const before = body.slice(0, start)
    const rule = /\r?\n[ \t]*-{3,}[ \t]*\r?\n(?:[ \t]*\r?\n)*$/.exec(before)
    return rule ? rule.index + (before[rule.index] === '\r' ? 2 : 1) : start
  }
  return -1
}

/**
 * Index where the generator trailer begins in `body` (the `---` rule line of
 * the SEO & AIO or Structured Data trailer, or the first line of a heading-
 * less label run), or -1. The single anchor set shared by the strip, the page
 * repair, and the editor's trailer split (lib/editor/page-body.ts).
 */
export function findTrailerStart(body: string): number {
  const starts = [
    trailerStart(body, SEO_TRAILER_RE),
    trailerStart(body, STRUCTURED_TRAILER_RE),
    bareLabelRunStart(body),
  ].filter((i) => i >= 0)
  return starts.length ? Math.min(...starts) : -1
}

/**
 * Labels / trailer headings present in `text` — for validators. Anything
 * non-empty means generator notes are sitting in a reader-facing body.
 */
export function findGeneratorNotes(text: string): string[] {
  const found: string[] = []
  if (trailerStart(text, SEO_TRAILER_RE) >= 0) found.push('SEO & AIO Metadata')
  if (trailerStart(text, STRUCTURED_TRAILER_RE) >= 0) found.push('Structured Data')
  const labels = labelsIn(text).filter((l) => l !== 'Call to Action')
  // A single stray bold label is not enough to call it a leak.
  if (labels.length >= 2 || found.length > 0) found.push(...labels)
  return found
}

/**
 * Cut every generator-notes section out of a reader-facing body (post body,
 * or model output before it is persisted). Idempotent. Everything after the
 * earliest trailer marker is removed — both trailers always sit at the end.
 */
export function stripGeneratorNotesFromBody(body: string): BodyStripResult {
  const cut = findTrailerStart(body)
  if (cut < 0) return { body, removed: [], removedText: '' }
  const removedText = body.slice(cut)
  const foreign = foreignHeadings(removedText)
  if (foreign.length > 0) {
    return {
      body,
      removed: [],
      removedText: '',
      warning: `Generator notes found but not removed: content follows them (${foreign.join(' | ')})`,
    }
  }
  const removed: string[] = []
  if (trailerStart(removedText, SEO_TRAILER_RE) >= 0) removed.push('SEO & AIO Metadata')
  removed.push(...labelsIn(removedText))
  if (trailerStart(removedText, STRUCTURED_TRAILER_RE) >= 0) removed.push('Structured Data')
  const kept = body.slice(0, cut).replace(/\s+$/, '')
  return { body: kept ? `${kept}${eolOf(body)}` : '', removed, removedText }
}

// Text under `**Label:**` up to the next label line or the Structured Data rule.
function sectionText(text: string, label: string): string | null {
  const re = new RegExp(`^[ \\t]*\\*\\*${label.replace(/[-]/g, '\\-')}:\\*\\*[ \\t]*\\r?$`, 'm')
  const m = re.exec(text)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  LABEL_LINE_RE.lastIndex = 0
  const ends = [
    rest.search(LABEL_LINE_RE),
    rest.search(/^[ \t]*\*\*Call to Action:\*\*/m),
    rest.search(/^[ \t]*-{3,}[ \t]*\r?$/m),
  ].filter((i) => i >= 0)
  return rest.slice(0, ends.length ? Math.min(...ends) : rest.length).trim()
}

function bulletLines(section: string | null): string[] {
  if (!section) return []
  return section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l && !/^none(?: specified)?$/i.test(l))
}

/** Recover the structured data a generator trailer carries. */
export function parseGeneratorNotes(trailer: string): ParsedGeneratorNotes {
  const answer = sectionText(trailer, 'Answer Block')
  const citation = sectionText(trailer, 'LLM Citation Note')
  const internalLinks = bulletLines(sectionText(trailer, 'Internal Links')).flatMap((line) => {
    // `anchor → url — reason` (buildPageMarkdown's exact shape).
    const m = /^(.+?)\s+→\s+(\S+)(?:\s+[—–,]\s+(.*))?$/.exec(line)
    return m ? [{ url: m[2], anchor_text: m[1].trim(), reason: (m[3] ?? '').trim() }] : []
  })
  const faqBlock: ParsedGeneratorNotes['faqBlock'] = []
  const faq = sectionText(trailer, 'FAQ Block')
  if (faq) {
    for (const m of faq.matchAll(/\*\*Q:\s*(.+?)\*\*[ \t]*\r?\nA:[ \t]*([\s\S]+?)(?=\r?\n\s*\*\*Q:|$)/g)) {
      faqBlock.push({ question: m[1].trim(), answer: m[2].trim() })
    }
  }
  return {
    answerBlock: answer || null,
    eeatSignals: bulletLines(sectionText(trailer, 'E-E-A-T Signals')),
    internalLinks,
    faqBlock,
    llmCitationNote: citation || null,
  }
}

// ── File-level (frontmatter + body) ─────────────────────────────────────────

function splitFrontmatter(
  content: string
): { open: string; fmInner: string; close: string; body: string } | null {
  const open = /^---[ \t]*\r?\n/.exec(content)
  if (!open) return null
  const rest = content.slice(open[0].length)
  const close = /(^|\r?\n)---[ \t]*(?:\r?\n|$)/.exec(rest)
  if (!close) return null
  return {
    open: open[0],
    fmInner: rest.slice(0, close.index),
    close: close[0],
    body: rest.slice(close.index + close[0].length),
  }
}

// Empty / missing value for a top-level frontmatter key. Returns the line index
// to replace (or -1 when the key is absent) and whether it counts as empty.
function fmSlot(lines: string[], key: string): { index: number; empty: boolean } {
  const i = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (i < 0) return { index: -1, empty: true }
  const value = lines[i].slice(key.length + 1).trim()
  // A block value (`key:` + indented lines) is data — not empty.
  const next = lines[i + 1] ?? ''
  const blockFollows = value === '' && /^\s+\S/.test(next)
  return { index: i, empty: !blockFollows && ['', '""', "''", '[]', 'null', '~'].includes(value) }
}

export interface FileStripResult {
  content: string
  changed: boolean
  removed: string[]
  removedText: string
  /** Frontmatter keys filled from the trailer because they were empty. */
  backfilled: string[]
  /** See BodyStripResult.warning — the file was left unchanged. */
  warning?: string
}

/**
 * Strip generator notes from a POST file's body. Frontmatter stays byte-for-
 * byte identical, except that a structured field the trailer carries
 * (answer_block, eeat_signals, internal_links, faq_block, llm_citation_note)
 * is written when — and only when — that key is missing or empty.
 */
export function stripGeneratorNotesFromFile(content: string): FileStripResult {
  const parts = splitFrontmatter(content)
  const body = parts ? parts.body : content
  const res = stripGeneratorNotesFromBody(body)
  if (!res.removedText) {
    return {
      content,
      changed: false,
      removed: [],
      removedText: '',
      backfilled: [],
      ...(res.warning ? { warning: res.warning } : {}),
    }
  }
  if (!parts) {
    return { content: res.body, changed: true, removed: res.removed, removedText: res.removedText, backfilled: [] }
  }

  const notes = parseGeneratorNotes(res.removedText)
  const candidates: Array<[string, unknown, boolean]> = [
    ['answer_block', notes.answerBlock, !!notes.answerBlock],
    ['eeat_signals', notes.eeatSignals, notes.eeatSignals.length > 0],
    ['internal_links', notes.internalLinks, notes.internalLinks.length > 0],
    ['faq_block', notes.faqBlock, notes.faqBlock.length > 0],
    ['llm_citation_note', notes.llmCitationNote, !!notes.llmCitationNote],
  ]
  const eol = eolOf(content)
  const lines = parts.fmInner.split(/\r?\n/)
  const backfilled: string[] = []
  for (const [key, value, has] of candidates) {
    if (!has) continue
    const slot = fmSlot(lines, key)
    if (!slot.empty) continue
    const line = `${key}: ${JSON.stringify(value)}`
    if (slot.index >= 0) lines[slot.index] = line
    else lines.push(line)
    backfilled.push(key)
  }
  const head = parts.open + (backfilled.length ? lines.join(eol) : parts.fmInner) + parts.close
  return {
    content: head + res.body,
    changed: true,
    removed: res.removed,
    removedText: res.removedText,
    backfilled,
  }
}

/**
 * PAGE files keep their trailer (the template trims it and reuses the JSON-LD),
 * but only while the "## SEO & AIO Metadata" marker leads it. If that marker
 * was edited away and a Structured Data block survives, the template renders
 * the JSON-LD as a live code block. Restore the marker in front of it so the
 * template trims again and the schema is kept. Idempotent; no-op otherwise.
 */
export function repairPageTrailer(content: string): { content: string; changed: boolean } {
  const seo = trailerStart(content, SEO_TRAILER_RE)
  const structured = trailerStart(content, STRUCTURED_TRAILER_RE)
  const run = bareLabelRunStart(content)
  const starts = [run, structured].filter((i) => i >= 0)
  if (starts.length === 0) return { content, changed: false }
  const at = Math.min(...starts)
  if (seo >= 0 && seo < at) return { content, changed: false }
  const eol = eolOf(content)
  const marker = `---${eol}## SEO & AIO Metadata${eol}${eol}`
  const before = content.slice(0, at).replace(/\s+$/, '')
  if (at === run) {
    // The label run lost only its heading: put it back under the run's own
    // `---` rule when there is one, else open a new rule + heading.
    const rule = /^-{3,}[ \t]*\r?\n(?:[ \t]*\r?\n)*/.exec(content.slice(at))
    const rest = content.slice(at + (rule ? rule[0].length : 0))
    return { content: `${before}${eol}${eol}${marker}${rest}`, changed: true }
  }
  return { content: `${before}${eol}${eol}${marker}${content.slice(at)}`, changed: true }
}
