// Minimal YAML frontmatter parser/serializer specialized to the page-file
// format produced by lib/content/deliverable-builder.ts → buildPageMarkdown().
// That format uses only single-line key: value pairs and one inline array
// (`secondary_keywords: [a, b, c]`). We do not need a full YAML parser; a
// small targeted one keeps the dependency footprint small and the behavior
// predictable.

export type Frontmatter = {
  raw: string                          // original text between the `---` markers
  fields: Record<string, string>       // string-typed values
  arrayFields: Record<string, string[]> // for inline arrays like secondary_keywords
  order: string[]                      // key order for stable round-trip
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
  const inner = trimmed.slice(1, -1).trim()
  if (inner === '') return []
  return inner.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

export function parseFrontmatter(raw: string): Frontmatter {
  const fields: Record<string, string> = {}
  const arrayFields: Record<string, string[]> = {}
  const order: string[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (!key) continue
    const asArray = parseInlineArray(value)
    if (asArray) {
      arrayFields[key] = asArray
    } else {
      fields[key] = value
    }
    if (!order.includes(key)) order.push(key)
  }
  return { raw, fields, arrayFields, order }
}

// Serialize frontmatter + body back to a page .md string. Preserves field
// order and choice of array vs string for each key from the original parse.
export function serializeFile(file: PageFile): string {
  if (!file.frontmatter) return file.body
  const { fields, arrayFields, order } = file.frontmatter
  const lines: string[] = [FENCE]
  for (const key of order) {
    if (key in arrayFields) {
      lines.push(`${key}: [${arrayFields[key].join(', ')}]`)
    } else if (key in fields) {
      lines.push(`${key}: ${fields[key]}`)
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
