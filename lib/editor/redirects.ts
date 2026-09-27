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
//   4. an add whose source is another add's destination in the same batch is
//      skipped (a swap refills that url);
//   5. self-redirects (X→X, after normalization) are dropped;
//   6. any loop already in the file is broken (its newest row is dropped).
//
// Rows whose source has a real page are NOT removed on a save or a deploy (an
// operator may have written them); they come back as warnings
// (liveRedirectWarnings) for the UI. Only the code-view commit (PATCH /files,
// validateRedirectsCsv) refuses them outright.
//
// Comment lines, the header and unrelated rows are kept byte-for-byte.

import { contentPathToUrl } from './content-paths'
import { toPathname } from './nav-urls'
import { DEFAULT_BLOG_PATH, normalizeBlogPath } from '@/lib/content/blog-config'

export const REDIRECTS_HEADER = 'old_url,new_url,status_code,reason\n'

export type RedirectRow = { from: string; to: string; status: string; reason: string }

type Line = { kind: 'raw'; text: string } | { kind: 'row'; row: RedirectRow; text: string | null }

export type RedirectAdd = { from: string; to: string }

export interface RedirectOptions {
  /** Root-relative urls that have a real page in the tree (warned / refused). */
  livePaths?: Iterable<string>
}

// Comparable form of a redirect url: host and trailing slash stripped, so
// `https://x.com/a/`, `/a/` and `/a` are the same source. Lowercased, because
// Next.js matches redirect sources case-INsensitively by default
// (caseSensitiveRoutes: false): `/About-Us → /about-us` is a self-redirect and
// `/About` shadows a live `/about`. Non-path values fall back to the trimmed
// string so they still compare consistently.
export function redirectKey(url: string): string {
  // A ?query or #hash never takes part in source matching, and a destination
  // `/b?x=1` lands on /b: drop both, for absolute and root-relative urls alike,
  // so `/a,/b?x=1` + `/b,/a` is seen as the loop it is.
  const t = url.trim().replace(/[?#].*$/, '')
  return (toPathname(t) ?? t).toLowerCase()
}

/**
 * A root-relative redirect source without its trailing slash (`/` itself is
 * kept). The template's next.config has trailingSlash: false, so Next first
 * 308s `/a/` to `/a` and then matches custom sources strictly: a `/a/` row
 * never fires. Absolute or empty values are returned unchanged.
 */
export function normalizeRedirectSource(from: string): string {
  const t = from.trim()
  if (!t.startsWith('/') || t.length < 2 || !t.endsWith('/')) return from
  return t.replace(/\/+$/, '') || '/'
}

// Rewrite rows whose source has a trailing slash (see normalizeRedirectSource).
// Every other line keeps its bytes.
function normalizeSourceLines(lines: Line[]): Line[] {
  return lines.map((l) => {
    if (l.kind !== 'row') return l
    const from = normalizeRedirectSource(l.row.from)
    return from === l.row.from ? l : { kind: 'row', row: { ...l.row, from }, text: null }
  })
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/

/**
 * Mirror of the template loader's redirectDestinationError
 * (src/lib/redirects/parse-redirects-csv.ts): a row whose destination fails it
 * is SKIPPED at build, so it is never an edge of the live redirect graph.
 */
export function redirectDestinationError(to: string): string | null {
  const t = to.trim()
  if (!t.startsWith('/')) return 'non-relative destination'
  if (t.startsWith('//') || t.startsWith('/\\')) return 'protocol-relative destination'
  if (CONTROL_RE.test(t)) return 'control character in destination'
  return null
}

// A Next.js path-pattern source (`/blog/:slug`, `/old/*`, `/(a|b)`) matches
// many urls, so it is never compared against individual live pages.
// The check runs on the PATH, so an absolute `https://host/about` (whose
// scheme colon is not a pattern) is still compared against live pages.
function isPatternSource(url: string): boolean {
  const t = url.trim().replace(/[?#].*$/, '')
  return /[:*(]/.test(toPathname(t) ?? t)
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

// Public base path of the site's posts from its content/blog.json text (the
// template remaps posts to e.g. /insights); /resources when absent or invalid.
export function blogPathFromJson(text: string | null | undefined): string {
  if (!text) return DEFAULT_BLOG_PATH
  try {
    const raw: unknown = JSON.parse(text)
    return normalizeBlogPath(raw && typeof raw === 'object' ? (raw as { path?: unknown }).path : undefined)
  } catch {
    return DEFAULT_BLOG_PATH
  }
}

// Root-relative urls of every published page/post in a list of repo paths
// (drafts excluded — they are off-site). Used to build `livePaths`. Posts live
// under the site's blog path (content/blog.json `path`, e.g. korbey /insights),
// so a `/resources/<slug>,/insights/<slug>` row is not over a live post.
export function pageUrlsFromPaths(paths: Iterable<string>, blogPath: string = DEFAULT_BLOG_PATH): Set<string> {
  const out = new Set<string>()
  for (const p of paths) {
    if (p.startsWith('content/drafts/')) continue
    const post = /^content\/posts\/(.+)\.md$/.exec(p)
    if (post) {
      out.add(`${blogPath}/${post[1]}`)
      continue
    }
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

// Drop self-redirects. Pure line filter.
function dropSelfRows(lines: Line[]): Line[] {
  return lines.filter((l) => l.kind !== 'row' || redirectKey(l.row.from) !== redirectKey(l.row.to))
}

/** A row whose source still has a real page (the redirect would shadow it). */
export type LiveRedirectWarning = { from: string; to: string }

/**
 * Rows in `text` whose source has a real page in `livePaths`. Never removed
 * automatically; the deploy plan and the nav/move save responses report them.
 */
export function liveRedirectWarnings(text: string, opts: RedirectOptions = {}): LiveRedirectWarning[] {
  const live = keySet(opts.livePaths)
  if (live.size === 0) return []
  return parseRedirectRows(text)
    .filter(
      (r) =>
        !redirectDestinationError(r.to) &&
        !isPatternSource(r.from) &&
        live.has(redirectKey(r.from)) &&
        redirectKey(r.from) !== redirectKey(r.to)
    )
    .map((r) => ({ from: r.from, to: r.to }))
}

export function formatLiveRedirectWarning(w: LiveRedirectWarning): string {
  return `${w.from} has a real page but redirects to ${w.to}, so the page is unreachable. Remove that row from redirects.csv or move the page.`
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
): { content: string; changed: boolean; warnings: LiveRedirectWarning[] } {
  const original = text ?? ''
  let lines = normalizeSourceLines(parseLines(text ?? REDIRECTS_HEADER))
  const batchTargets = new Set(adds.map((m) => redirectKey(m.to)))

  for (const add of adds) {
    const a = redirectKey(add.from)
    const b = redirectKey(add.to)
    if (!a || !b || a === b) continue
    // 4. Another move in this batch puts a page back at A (a swap): no 301 away
    //    from it. That move's rule 1 already cleared A's old rows.
    if (batchTargets.has(a)) continue

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
    if (!placed) {
      next.push({ kind: 'row', row: { from: normalizeRedirectSource(add.from), to: add.to, status: '301', reason }, text: null })
    }
    lines = next
  }

  // 5 + 6. Self-redirects and loops never survive a write.
  lines = breakCycles(dropSelfRows(lines))

  const content = serializeLines(lines)
  return { content, changed: content !== original, warnings: liveRedirectWarnings(content, opts) }
}

export type RedirectProblems = {
  /** Each cycle as the ordered list of its sources, e.g. ['/a', '/b'] for /a→/b→/a. */
  cycles: string[][]
  /** Rows whose source equals their destination. */
  selfRedirects: string[]
  /** Sources that have a real page in the tree (only when livePaths is given). */
  shadowedPages: string[]
  /**
   * Sources `next build` rejects or never matches: not root-relative (no
   * leading '/', e.g. an absolute old-site url) or carrying a ?query / #hash.
   */
  invalidSources: string[]
  /**
   * `from → to` of rows the template skips at build (destination not a same-site
   * path, e.g. an absolute url). Never counted as edges.
   */
  skippedDestinations: string[]
}

/** Find redirect loops, self-redirects and redirected live pages. Pure. */
export function findRedirectProblems(text: string, opts: RedirectOptions = {}): RedirectProblems {
  const live = keySet(opts.livePaths)
  const edges = new Map<string, string>()
  const selfRedirects: string[] = []
  const shadowedPages: string[] = []
  const invalidSources: string[] = []
  const skippedDestinations: string[] = []
  for (const row of parseRedirectRows(text)) {
    const rawFrom = row.from.trim()
    if ((!rawFrom.startsWith('/') || /[?#]/.test(rawFrom)) && !invalidSources.includes(rawFrom)) {
      invalidSources.push(rawFrom)
    }
    // The template skips this row at build: it is not part of the live graph.
    if (redirectDestinationError(row.to)) {
      skippedDestinations.push(`${rawFrom} → ${row.to.trim()}`)
      continue
    }
    const from = redirectKey(row.from)
    const to = redirectKey(row.to)
    if (from === to) {
      selfRedirects.push(from)
      continue
    }
    // Pattern sources (`:slug`, `*`) are not checked against live pages.
    if (!isPatternSource(row.from) && live.has(from) && !shadowedPages.includes(from)) shadowedPages.push(from)
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
  return { cycles, selfRedirects, shadowedPages, invalidSources, skippedDestinations }
}

/**
 * Commit-time guard for a raw redirects.csv write. Returns a user-facing error
 * (the caller answers 422) or null when the file is safe to commit.
 */
export function validateRedirectsCsv(text: string, opts: RedirectOptions = {}): string | null {
  const { cycles, selfRedirects, shadowedPages, invalidSources, skippedDestinations } = findRedirectProblems(text, opts)
  const problems: string[] = []
  for (const r of skippedDestinations) {
    problems.push(`${r} is ignored by the site (the destination must be a path starting with /, not a full url)`)
  }
  for (const s of invalidSources) {
    problems.push(
      s.startsWith('/')
        ? `${s} has a ?query or #hash (Next.js redirect sources are paths only)`
        : `${s} must be a path starting with / (not a full url)`
    )
  }
  for (const c of cycles) problems.push(`redirect loop ${[...c, c[0]].join(' → ')}`)
  for (const s of selfRedirects) problems.push(`${s} redirects to itself`)
  for (const s of shadowedPages) problems.push(`${s} has a real page but is redirected away`)
  if (problems.length === 0) return null
  return `redirects.csv can't be saved: ${problems.join('; ')}. Remove or change those rows so every redirect ends at a page.`
}

/**
 * Make an existing redirects.csv loop-free without adding anything: strips
 * trailing slashes from sources (a `/a/` source never matches), drops
 * self-redirects and breaks loops (newest row dropped). Rows over live pages
 * are kept (see liveRedirectWarnings). Untouched rows, comments and the header
 * are kept byte-for-byte. Used by the deploy merge, which is what heals the
 * loops already on live sites.
 */
export function sanitizeRedirectsCsv(text: string): string {
  return serializeLines(breakCycles(dropSelfRows(normalizeSourceLines(parseLines(text)))))
}

/**
 * Only strip trailing slashes from sources (no loop breaking). Used by the
 * one-off repair script for redirects.csv files already on client repos.
 */
export function normalizeRedirectSources(text: string): string {
  return serializeLines(normalizeSourceLines(parseLines(text)))
}

/** Resolve a destination through existing rows to the end of its chain. */
export function resolveRedirectTarget(text: string, url: string): string {
  const edges = new Map<string, string>()
  for (const row of parseRedirectRows(text)) {
    if (redirectDestinationError(row.to)) continue
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
