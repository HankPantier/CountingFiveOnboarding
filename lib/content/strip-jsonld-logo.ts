// Pure. Removes the broken `"logo": "<origin>/logo.png"` member that the JSON-LD
// builder used to write into every page's Organization node (fixed at source in
// json-ld-builder.ts; no client site serves /logo.png — the template layout's
// site-wide Organization node carries the real brand.json logo). Repairs the
// page files already in client repos (scripts/strip-jsonld-logo.ts).
//
// The edit is line-level so the rest of each block stays byte-identical: the
// `"logo"` line is dropped (and, when it was the last member, the previous
// line's trailing comma). Every edited block is re-parsed and must equal the
// original minus `logo`; a block that doesn't is left alone and counted.

const BLOCK_RE = /(<script type="application\/ld\+json">\r?\n)([\s\S]*?)(\r?\n<\/script>)/g
const LOGO_LINE_RE = /^([ \t]*)"logo":[ \t]*"(?:[^"\\]|\\.)*\/logo\.png",?[ \t]*$/m

function isBrokenOrganization(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return o['@type'] === 'Organization' && typeof o.logo === 'string' && /\/logo\.png$/.test(o.logo)
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function editBlock(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!isBrokenOrganization(parsed)) return null
  const m = LOGO_LINE_RE.exec(body)
  if (!m) return null
  const start = m.index
  const end = start + m[0].length
  const hadComma = /,[ \t]*$/.test(m[0])
  let before = body.slice(0, start)
  let after = body.slice(end)
  // Drop the line break that followed the removed line.
  after = after.replace(/^\r?\n/, '')
  if (!hadComma) {
    // It was the last member: the previous member's comma must go too.
    before = before.replace(/,([ \t]*\r?\n)$/, '$1')
  }
  const next = before + after
  const expected: Record<string, unknown> = { ...parsed }
  delete expected.logo
  try {
    return sameJson(JSON.parse(next), expected) ? next : null
  } catch {
    return null
  }
}

export type StripJsonLdLogoResult = { content: string; removed: number; skipped: number }

export function stripBrokenJsonLdLogo(text: string): StripJsonLdLogoResult {
  let removed = 0
  let skipped = 0
  const content = text.replace(BLOCK_RE, (whole, open: string, body: string, close: string) => {
    if (!/\/logo\.png"/.test(body)) return whole
    const next = editBlock(body)
    if (next === null) {
      skipped++
      return whole
    }
    removed++
    return open + next + close
  })
  return { content, removed, skipped }
}
