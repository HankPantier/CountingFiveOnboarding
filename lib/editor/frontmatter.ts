// Minimal YAML frontmatter parser/serializer specialized to the page-file
// format produced by lib/content/deliverable-builder.ts → buildPageMarkdown().
// That format uses only single-line key: value pairs and one inline array
// (`secondary_keywords: [a, b, c]`). We do not need a full YAML parser; a
// small targeted one keeps the dependency footprint small and the behavior
// predictable.
//
// Hand-edited or imported files can still carry multi-line YAML (a block list
// `tags:\n  - a`, a folded `description: >-` scalar, comments). Those
// continuation lines are NOT interpreted — they are kept verbatim, attached to
// the key above them, and re-emitted unchanged on serialize (unless the editor
// replaced that key's value, in which case the new scalar wins).

export type Frontmatter = {
  raw: string                          // original text between the `---` markers
  fields: Record<string, string>       // string-typed values
  arrayFields: Record<string, string[]> // for inline arrays like secondary_keywords
  order: string[]                      // key order for stable round-trip
  // Verbatim continuation lines (block lists, block scalars, indented lines)
  // under a key, plus the header value that key had when parsed. Re-emitted as-is
  // while fields[key] still equals `header`.
  blocks?: Record<string, { header: string; lines: string[] }>
  // Lines before the first key (e.g. comments), re-emitted verbatim.
  preamble?: string[]
}

export type PageFile = {
  frontmatter: Frontmatter | null
  body: string
}

const FENCE = '---'

// Splits a page .md into its frontmatter and body. If the file does not start
// with `---`, frontmatter is null and body === input.
export function splitFile(text: string): PageFile {
  if (!text.startsWith(FENCE + '\n') && !text.startsWith(FENCE + '\r\n')) {
    return { frontmatter: null, body: text }
  }
  const afterOpen = text.indexOf('\n', FENCE.length) + 1
  const closeIdx = text.indexOf('\n' + FENCE, afterOpen)
  if (closeIdx < 0) return { frontmatter: null, body: text }
  const raw = text.slice(afterOpen, closeIdx)
  // Body starts after the closing fence line. Closing fence is "\n---" and we
  // skip the rest of that line too.
  let bodyStart = closeIdx + ('\n' + FENCE).length
  // Skip optional trailing chars on the fence line (whitespace, then newline).
  while (bodyStart < text.length && text[bodyStart] !== '\n') bodyStart++
  if (text[bodyStart] === '\n') bodyStart++
  const body = text.slice(bodyStart)
  return { frontmatter: parseFrontmatter(raw), body }
}

function parseInlineArray(value: string): string[] | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  const inner = trimmed.slice(1, -1)
  // Only bare scalar lists (e.g. `secondary_keywords: [a, b, c]`) are inline
  // string arrays. JSON arrays of objects/strings (faq_block, internal_links,
  // eeat_signals) contain quotes/braces — comma-splitting would corrupt them,
  // so leave them as a verbatim string field for the typed accessors to parse.
  if (/["{}]/.test(inner)) return null
  const innerTrim = inner.trim()
  if (innerTrim === '') return []
  return innerTrim.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

// A top-level `key: value` line: starts at column 0 with something other than
// whitespace, a list dash, or a comment, and has a colon. Anything else (indented
// lines, `- item`, `# comment`) is a continuation of the previous key.
function isKeyLine(line: string): boolean {
  if (line.length === 0 || /^[\s#-]/.test(line)) return false
  return line.indexOf(':') > 0
}

export function parseFrontmatter(raw: string): Frontmatter {
  const fields: Record<string, string> = {}
  const arrayFields: Record<string, string[]> = {}
  const order: string[] = []
  const blocks: Record<string, { header: string; lines: string[] }> = {}
  const preamble: string[] = []
  let currentKey: string | null = null
  let pendingBlank = 0
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.trim() === '') {
      pendingBlank++
      continue
    }
    if (!isKeyLine(line)) {
      // Continuation line — keep verbatim under the current key (blank lines
      // inside the block are preserved; blanks before a new key are dropped).
      const target = currentKey
      if (target === null) {
        preamble.push(line)
      } else {
        const block = blocks[target] ?? { header: fields[target] ?? '', lines: [] }
        for (; pendingBlank > 0; pendingBlank--) if (block.lines.length > 0) block.lines.push('')
        block.lines.push(line)
        blocks[target] = block
      }
      pendingBlank = 0
      continue
    }
    pendingBlank = 0
    const colon = line.indexOf(':')
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (!key) continue
    const asArray = parseInlineArray(value)
    if (asArray) {
      arrayFields[key] = asArray
      delete fields[key]
    } else {
      fields[key] = value
      delete arrayFields[key]
    }
    // A re-declared key supersedes any block captured for the earlier one.
    delete blocks[key]
    currentKey = key
    if (!order.includes(key)) order.push(key)
  }
  // A block's header is the scalar on the key line (usually '' or '|' / '>-').
  for (const key of Object.keys(blocks)) {
    if (key in arrayFields) delete blocks[key]
  }
  const fm: Frontmatter = { raw, fields, arrayFields, order }
  if (Object.keys(blocks).length > 0) fm.blocks = blocks
  if (preamble.length > 0) fm.preamble = preamble
  return fm
}

// Serialize frontmatter + body back to a page .md string. Preserves field
// order and choice of array vs string for each key from the original parse.
export function serializeFile(file: PageFile): string {
  if (!file.frontmatter) return file.body
  const { fields, arrayFields, order, blocks, preamble } = file.frontmatter
  const lines: string[] = [FENCE]
  if (preamble) lines.push(...preamble)
  const scalarLine = (key: string, value: string) => (value === '' ? `${key}:` : `${key}: ${value}`)
  for (const key of order) {
    if (key in arrayFields) {
      lines.push(`${key}: [${arrayFields[key].join(', ')}]`)
    } else if (key in fields) {
      const block = blocks?.[key]
      if (block && fields[key] === block.header) {
        // Untouched multi-line value — re-emit exactly as parsed.
        lines.push(scalarLine(key, block.header), ...block.lines)
      } else {
        lines.push(`${key}: ${fields[key]}`)
      }
    }
  }
  // Include any keys not yet in order (e.g. newly added by editor).
  for (const key of Object.keys(fields)) {
    if (!order.includes(key)) lines.push(`${key}: ${fields[key]}`)
  }
  for (const key of Object.keys(arrayFields)) {
    if (!order.includes(key)) {
      lines.push(`${key}: [${arrayFields[key].join(', ')}]`)
    }
  }
  lines.push(FENCE)
  return lines.join('\n') + '\n' + file.body
}
