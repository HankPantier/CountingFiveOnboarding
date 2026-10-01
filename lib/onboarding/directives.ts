import type {
  DirectiveSnapshot,
  OperatorDirective,
  OperatorDirectiveKind,
  SessionSchema,
} from '@/types/session-schema'
import { toSitePath } from '@/lib/content/url-path'

export const DIRECTIVE_KINDS: readonly OperatorDirectiveKind[] = [
  'bring_page',
  'verbatim_content',
  'add_offering',
  'merge_page',
  'drop_page',
  'other',
]

export const MAX_DIRECTIVES = 40
const MAX_SOURCE_TEXT = 1000
const MAX_VERBATIM_TEXT = 12000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const isKind = (v: unknown): v is OperatorDirectiveKind =>
  typeof v === 'string' && (DIRECTIVE_KINDS as readonly string[]).includes(v)

export const normPath = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase() || '/'

export const snapshotPrefix = (sessionId: string): string => `snapshots/${sessionId}/`

// Decode-then-normalize before the prefix check (CLAUDE.md rule 8): an encoded
// `..%2F` must not escape the session's snapshot folder.
export function isValidSnapshotPath(path: string, sessionId: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  if (decoded !== path) return false
  const prefix = snapshotPrefix(sessionId)
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  return /^[0-9a-f-]{36}\.md$/i.test(rest)
}

// Whitespace-insensitive containment: the guard that a "verbatim" passage really
// is the client's text and not an AI paraphrase of it.
export const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim()
export function isVerbatimSubstring(passage: string, source: string): boolean {
  const p = collapseWs(passage)
  return p.length > 0 && collapseWs(source).includes(p)
}

export interface CrawledPageRef {
  url: string
  title: string
}

// The crawled pages a directive may point at: current_sitemap rows with a
// root-relative path. Redirect worklist rows have no page to bring over — except
// one an operator drop/merge directive turned into a redirect, which must stay
// addressable so that directive still resolves on a resubmit.
export function crawledPages(schema: SessionSchema): CrawledPageRef[] {
  const rows = Array.isArray(schema.current_sitemap) ? schema.current_sitemap : []
  const seen = new Set<string>()
  const out: CrawledPageRef[] = []
  for (const r of rows) {
    if (!r || typeof r.url !== 'string' || (r.action === 'redirect' && !r.directiveId)) continue
    const path = toSitePath(r.url) ?? r.url
    if (!path.startsWith('/')) continue
    const key = normPath(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ url: path, title: str(r.title) || path })
  }
  return out
}

export const hasCrawledPage = (pages: CrawledPageRef[], url: string): boolean =>
  pages.some((p) => normPath(p.url) === normPath(url))

function coerceSnapshot(raw: unknown, sessionId: string): DirectiveSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const path = str(r.path)
  if (!isValidSnapshotPath(path, sessionId)) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
  return { path, capturedAt: str(r.capturedAt) || new Date().toISOString(), words: num(r.words), links: num(r.links) }
}

// Validates one client-posted directive. Never trusts `status`: it is recomputed
// by resolveDirectiveStatus against the session's real pages and team.
export function coerceDirective(raw: unknown, sessionId: string): OperatorDirective | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isKind(r.kind)) return null
  const id = str(r.id)
  if (!UUID_RE.test(id)) return null
  const sourceText = str(r.sourceText).slice(0, MAX_SOURCE_TEXT)
  if (!sourceText) return null

  const d: OperatorDirective = {
    id,
    kind: r.kind,
    sourceText,
    status: 'unresolved',
    createdAt: str(r.createdAt) || new Date().toISOString(),
  }
  const sourceUrl = str(r.sourceUrl)
  if (sourceUrl) d.sourceUrl = toSitePath(sourceUrl) ?? sourceUrl
  const targetUrl = str(r.targetUrl)
  if (targetUrl) d.targetUrl = toSitePath(targetUrl) ?? targetUrl
  if (r.verbatim === true) d.verbatim = true
  if (r.keepLinks === true) d.keepLinks = true
  const teamMember = str(r.teamMember)
  if (teamMember) d.teamMember = teamMember
  const verbatimText = typeof r.verbatimText === 'string' ? r.verbatimText.trim().slice(0, MAX_VERBATIM_TEXT) : ''
  if (verbatimText) d.verbatimText = verbatimText

  if (r.offering && typeof r.offering === 'object') {
    const o = r.offering as Record<string, unknown>
    const name = str(o.name)
    const type = o.type === 'niche' ? 'niche' : o.type === 'service' ? 'service' : null
    const treatment = o.treatment === 'block' ? 'block' : 'page'
    if (name && type) {
      d.offering = { type, name, treatment, ...(treatment === 'block' && str(o.parent) ? { parent: str(o.parent) } : {}) }
    }
  }
  const clarification = str(r.clarification).slice(0, MAX_SOURCE_TEXT)
  if (clarification) d.clarification = clarification
  const snapshot = coerceSnapshot(r.snapshot, sessionId)
  if (snapshot) d.snapshot = snapshot
  return d
}

// A directive is resolved only when everything it points at is real. `other`
// is always resolved (it is free guidance, honored via the firm context).
export function resolveDirectiveStatus(
  d: OperatorDirective,
  pages: CrawledPageRef[],
  teamNames: string[],
): 'resolved' | 'unresolved' {
  const hasPage = (u?: string) => !!u && hasCrawledPage(pages, u)
  const team = new Set(teamNames.map((n) => n.trim().toLowerCase()))
  switch (d.kind) {
    case 'bring_page':
      return hasPage(d.sourceUrl) && (!needsSnapshot(d) || !!d.snapshot) ? 'resolved' : 'unresolved'
    case 'merge_page':
      return hasPage(d.sourceUrl) && !!d.targetUrl && normPath(d.targetUrl) !== normPath(d.sourceUrl ?? '')
        ? 'resolved'
        : 'unresolved'
    case 'drop_page':
      return hasPage(d.sourceUrl) ? 'resolved' : 'unresolved'
    case 'verbatim_content': {
      if (!d.verbatimText || !d.snapshot) return 'unresolved'
      if (d.teamMember && !team.has(d.teamMember.toLowerCase())) return 'unresolved'
      return 'resolved'
    }
    case 'add_offering':
      return d.offering ? 'resolved' : 'unresolved'
    case 'other':
      return 'resolved'
  }
}

export const isResolved = (d: OperatorDirective): boolean => d.status === 'resolved'

// Cards that depend on a captured copy of the live page: verbatim pages and
// passages, and "keep all links" pages (their links are carried over from it).
export const needsSnapshot = (d: Pick<OperatorDirective, 'kind' | 'verbatim' | 'keepLinks'>): boolean =>
  (d.kind === 'bring_page' && (!!d.verbatim || !!d.keepLinks)) || d.kind === 'verbatim_content'

// The notes with every directive sentence removed, so the notes→MBP extractor
// only sees facts (it would otherwise file "bring the forms page over" as a fact).
export function notesWithoutDirectives(notes: string, directives: OperatorDirective[]): string {
  let out = notes
  for (const d of directives) {
    if (d.sourceText && out.includes(d.sourceText)) out = out.split(d.sourceText).join(' ')
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
