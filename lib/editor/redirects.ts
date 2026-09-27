// Pure, cycle-safe editing of a site's content/redirects.csv.
//
// Every writer of redirects.csv goes through here so the file can never
// accumulate the loops that broke live client sites (Berg: two rows pointing at
// each other; Pryor/Abramson: service pages bouncing between URLs; Accord: a
// real page redirected away). The old writers appended A→B without touching the
// reverse row B→A, and nothing checked for cycles.
//
// Rules applied when adding A→B (applyRedirectAdds):
//   1. any existing row whose source is B is removed (B is a live page again);
//   2. an existing row whose source is A is replaced (the newest move wins);
//   3. chains collapse: an existing X→A becomes X→B;
//   4. self-redirects (X→X, after normalization) are dropped;
//   5. with a `livePaths` set, no row may redirect a path that has a real page;
//   6. any loop already in the file is broken (its newest row is dropped).
//
// Comment lines, the header and unrelated rows are kept byte-for-byte.

import { contentPathToUrl } from './content-paths'
import { toPathname } from './nav-urls'

export const REDIRECTS_HEADER = 'old_url,new_url,status_code,reason\n'

export type RedirectRow = { from: string; to: string; status: string; reason: string }

type Line = { kind: 'raw'; text: string } | { kind: 'row'; row: RedirectRow; text: string | null }

export type RedirectAdd = { from: string; to: string }

export interface RedirectOptions {
  /** Root-relative urls that have a real page in the tree. Never redirected. */
  livePaths?: Iterable<string>
}

// Comparable form of a redirect url: host and trailing slash stripped, so
// `https://x.com/a/`, `/a/` and `/a` are the same source. Paths stay
// case-sensitive (Next's redirect matcher is). Non-path values fall back to the
// trimmed string so they still compare consistently.
export function redirectKey(url: string): string {
  const t = url.trim()
  return toPathname(t) ?? t
}

// RFC 4180 field quoting — a comma, quote or newline must never shift columns.
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

// Split the file into raw lines (comments, header, blanks, malformed) and data
// rows. Mirrors the template loader (src/lib/redirects/parse-redirects-csv.ts):
// `#` comments and the `old_url,` header are skipped; a row needs both fields.
function parseLines(text: string): Line[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  if (body === '') return []
  return body.split('\n').map((raw): Line => {
    const t = raw.trim()
    if (!t || t.startsWith('#') || t.startsWith('old_url,')) return { kind: 'raw', text: raw }
    const [from = '', to = '', status = '', reason = ''] = parseCsvLine(t)
    if (!from || !to) return { kind: 'raw', text: raw }
    return { kind: 'row', row: { from, to, status, reason }, text: raw }
  })
}

function serializeLines(lines: Line[]): string {
  if (lines.length === 0) return ''
  return (
    lines
      .map((l) => {
        if (l.kind === 'raw') return l.text
        if (l.text !== null) return l.text
        const { from, to, status, reason } = l.row
        return [from, to, status || '301', reason].map(csvField).join(',')
      })
      .join('\n') + '\n'
  )
}

/** Data rows of a redirects.csv, in file order. */
export function parseRedirectRows(text: string): RedirectRow[] {
  return parseLines(text).flatMap((l) => (l.kind === 'row' ? [l.row] : []))
}

// Root-relative urls of every published page/post in a list of repo paths
// (drafts excluded — they are off-site). Used to build `livePaths`.
export function pageUrlsFromPaths(paths: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const p of paths) {
    if (p.startsWith('content/drafts/')) continue
    const url = contentPathToUrl(p)
    if (url) out.add(url)
  }
  return out
}

function keySet(paths: Iterable<string> | undefined): Set<string> {
  const out = new Set<string>()
  for (const p of paths ?? []) out.add(redirectKey(p))
  return out
}

// Break every loop by dropping its last-listed row (the newest one written).
function breakCycles(input: Line[]): Line[] {
  let lines = input
  for (;;) {
    const { cycles } = findRedirectProblems(serializeLines(lines))
    if (cycles.length === 0) return lines
    const inCycle = new Set(cycles.flat())
    let lastIdx = -1
    lines.forEach((l, i) => {
      if (l.kind === 'row' && inCycle.has(redirectKey(l.row.from))) lastIdx = i
    })
    if (lastIdx < 0) return lines
    lines = lines.filter((_, i) => i !== lastIdx)
  }
}

// Drop self-redirects and rows that shadow a live page. Pure line filter.
function dropUnsafeRows(lines: Line[], live: Set<string>): Line[] {
  return lines.filter((l) => {
    if (l.kind !== 'row') return true
    const from = redirectKey(l.row.from)
    if (from === redirectKey(l.row.to)) return false
    return !live.has(from)
  })
}

/**
 * Add editor/AI relocation redirects A→B to a redirects.csv, keeping the file
 * acyclic (see the rules at the top of this file). `text === null` means the
 * file does not exist yet; the header is created. Returns the new text and
 * whether it differs from the input.
 */
export function applyRedirectAdds(
  text: string | null,
  adds: RedirectAdd[],
  reason: string,
  opts: RedirectOptions = {}
): { content: string; changed: boolean } {
  const original = text ?? ''
  let lines = parseLines(text ?? REDIRECTS_HEADER)
  const live = keySet(opts.livePaths)

  for (const add of adds) {
    const a = redirectKey(add.from)
    const b = redirectKey(add.to)
    if (!a || !b || a === b) continue

    let placed = false
    const next: Line[] = []
    for (const l of lines) {
      if (l.kind !== 'row') {
        next.push(l)
        continue
      }
      const from = redirectKey(l.row.from)
      const to = redirectKey(l.row.to)
      // 1. B is live again — any redirect away from it goes.
      if (from === b) continue
      // 2. The newest move for A wins (in place, so the file doesn't churn).
      if (from === a) {
        if (placed) continue
        placed = true
        if (to === b) next.push(l)
        else next.push({ kind: 'row', row: { ...l.row, to: add.to, status: l.row.status || '301', reason }, text: null })
        continue
      }
      // 3. Collapse X→A into X→B.
      if (to === a) {
        next.push({ kind: 'row', row: { ...l.row, to: add.to }, text: null })
        continue
      }
      next.push(l)
    }
    if (!placed) next.push({ kind: 'row', row: { from: add.from, to: add.to, status: '301', reason }, text: null })
    lines = next
  }

  // 4 + 5. Self-redirects and rows over a real page never survive a write,
  // and neither does any loop already in the file.
  lines = breakCycles(dropUnsafeRows(lines, live))

  const content = serializeLines(lines)
  return { content, changed: content !== original }
}

export type RedirectProblems = {
  /** Each cycle as the ordered list of its sources, e.g. ['/a', '/b'] for /a→/b→/a. */
  cycles: string[][]
  /** Rows whose source equals their destination. */
  selfRedirects: string[]
  /** Sources that have a real page in the tree (only when livePaths is given). */
  shadowedPages: string[]
}

/** Find redirect loops, self-redirects and redirected live pages. Pure. */
export function findRedirectProblems(text: string, opts: RedirectOptions = {}): RedirectProblems {
  const live = keySet(opts.livePaths)
  const edges = new Map<string, string>()
  const selfRedirects: string[] = []
  const shadowedPages: string[] = []
  for (const row of parseRedirectRows(text)) {
    const from = redirectKey(row.from)
    const to = redirectKey(row.to)
    if (from === to) {
      selfRedirects.push(from)
      continue
    }
    if (live.has(from) && !shadowedPages.includes(from)) shadowedPages.push(from)
    // Next.js applies the first matching rule, so a duplicate source is inert.
    if (!edges.has(from)) edges.set(from, to)
  }

  const cycles: string[][] = []
  const state = new Map<string, 'visiting' | 'done'>()
  for (const start of edges.keys()) {
    if (state.has(start)) continue
    const path: string[] = []
    let cur: string | undefined = start
    while (cur !== undefined && edges.has(cur) && !state.has(cur)) {
      state.set(cur, 'visiting')
      path.push(cur)
      cur = edges.get(cur)
    }
    if (cur !== undefined && state.get(cur) === 'visiting') {
      cycles.push(path.slice(path.indexOf(cur)))
    }
    for (const p of path) state.set(p, 'done')
  }
  return { cycles, selfRedirects, shadowedPages }
}

/**
 * Commit-time guard for a raw redirects.csv write. Returns a user-facing error
 * (the caller answers 422) or null when the file is safe to commit.
 */
export function validateRedirectsCsv(text: string, opts: RedirectOptions = {}): string | null {
  const { cycles, selfRedirects, shadowedPages } = findRedirectProblems(text, opts)
  const problems: string[] = []
  for (const c of cycles) problems.push(`redirect loop ${[...c, c[0]].join(' → ')}`)
  for (const s of selfRedirects) problems.push(`${s} redirects to itself`)
  for (const s of shadowedPages) problems.push(`${s} has a real page but is redirected away`)
  if (problems.length === 0) return null
  return `redirects.csv can't be saved: ${problems.join('; ')}. Remove or change those rows so every redirect ends at a page.`
}

/**
 * Make an existing redirects.csv safe without adding anything: drops
 * self-redirects, rows over live pages, and breaks loops (newest row dropped).
 * Untouched rows, comments and the header are kept byte-for-byte. Used by the
 * deploy merge, which is what heals the loops already on live sites.
 */
export function sanitizeRedirectsCsv(text: string, opts: RedirectOptions = {}): string {
  return serializeLines(breakCycles(dropUnsafeRows(parseLines(text), keySet(opts.livePaths))))
}

/** Resolve a destination through existing rows to the end of its chain. */
export function resolveRedirectTarget(text: string, url: string): string {
  const edges = new Map<string, string>()
  for (const row of parseRedirectRows(text)) {
    const from = redirectKey(row.from)
    if (!edges.has(from)) edges.set(from, row.to)
  }
  const seen = new Set<string>()
  let cur = url
  while (edges.has(redirectKey(cur)) && !seen.has(redirectKey(cur))) {
    seen.add(redirectKey(cur))
    cur = edges.get(redirectKey(cur)) as string
  }
  return cur
}
