import type { NavJson, NavItem } from '@/types/nav-json'
import { internalizeHref } from '@/lib/content/deliverable-builder'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SitemapEntry = {
  url: string
  title: string
  parent?: string
  status?: string // 'new' | 'update' | 'existing' | 'redirect' | 'consolidate'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 0 = primary, 1 = secondary, 2 = tertiary. Nothing below tertiary is rendered
// (header dropdowns show secondary; the side-nav shows secondary + tertiary).
const MAX_NAV_DEPTH = 2

/**
 * Validate that an unknown value has the shape of a NavJson.
 * Checks:
 * - Has a top-level `primary: NavItem[]`
 * - Each NavItem has `label: string` and `url: string`
 * - Children (if present) are also valid NavItems (recursive)
 * - Optional `cta` with `label: string` and `url: string`
 *
 * Returns the typed value or null if validation fails.
 */
function validateNavJson(value: unknown): NavJson | null {
  if (!value || typeof value !== 'object') return null

  const obj = value as Record<string, unknown>

  // Must have primary array
  if (!Array.isArray(obj.primary)) return null

  // Validate each NavItem in primary
  const isValidNavItem = (item: unknown): item is NavItem => {
    if (!item || typeof item !== 'object') return false
    const navItem = item as Record<string, unknown>
    if (typeof navItem.label !== 'string' || typeof navItem.url !== 'string') return false
    // If children exist, validate them recursively
    if (navItem.children !== undefined) {
      if (!Array.isArray(navItem.children)) return false
      return navItem.children.every(isValidNavItem)
    }
    return true
  }

  if (!obj.primary.every(isValidNavItem)) return null

  // Validate optional cta
  if (obj.cta !== undefined) {
    if (!obj.cta || typeof obj.cta !== 'object') return null
    const cta = obj.cta as Record<string, unknown>
    if (typeof cta.label !== 'string' || typeof cta.url !== 'string') return null
  }

  // Return a deep clone to avoid mutation
  return JSON.parse(JSON.stringify(obj)) as NavJson
}

/**
 * Humanize a URL slug into a label.
 * e.g., '/services/virtual-cfo-advisory' → 'Virtual Cfo Advisory'
 */
function slugToLabel(url: string): string {
  // Remove leading/trailing slashes
  const slug = url.replace(/^\/+|\/+$/g, '')
  // If empty after stripping, return generic fallback
  if (!slug) return 'Home'
  // Take the last segment (rightmost path component)
  const lastSegment = slug.split('/').pop() || slug
  // Replace hyphens with spaces, capitalize each word
  return lastSegment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Nav labels longer than this overflow the header (Berg's SEO-title labels
// pushed a 1440px page to 1782px). The package preflight lints against it.
export const NAV_LABEL_MAX = 30

const normWords = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const NAME_STOPWORDS = new Set(['the', 'our', 'a', 'an', 'and', 'of', 'at', 'for', 'to', 'in', 'on', 'by', 'with', 'your'])

// The words of a name that carry meaning ("The Berg Group" → berg, group).
const significantWords = (s: string): string[] =>
  normWords(s)
    .split(' ')
    .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w))

// Does `text` name the firm? The whole name (spaces optional: "BussCPA" for
// "Buss CPA"), or text whose first significant word is the firm's first
// significant word ("Berg Partners" for "The Berg Group"). Stopwords never
// match ("About The Team" is not "The Berg Group"). Without a firm name, falls
// back to generic firm-name words (CPA, LLC, Group, Advisors, …).
function namesFirm(text: string, firmName?: string): boolean {
  const s = normWords(text)
  if (!s) return false
  if (firmName) {
    const f = normWords(firmName)
    if (!f) return false
    if (s === f || s.replace(/ /g, '') === f.replace(/ /g, '')) return true
    const firmFirst = significantWords(firmName)[0]
    const textFirst = significantWords(text)[0]
    if (!firmFirst || !textFirst) return false
    return textFirst === firmFirst || (textFirst.startsWith(firmFirst) && s.replace(/ /g, '').startsWith(firmFirst))
  }
  return /\b(cpas?|llc|pllc|pc|llp|inc|group|advisors|accounting|consulting|associates)\b/.test(s)
}

// Service words that often lead a firm's name ("Tax Pros LLC", "Accounting
// Solutions Group") but just as often lead a page title ("About Tax Planning").
const GENERIC_LEAD_WORDS = new Set([
  'tax', 'taxes', 'accounting', 'accountants', 'business', 'financial', 'finance', 'bookkeeping',
  'advisory', 'payroll', 'wealth', 'consulting', 'audit', 'cpa', 'cpas', 'small',
])

// Stricter namesFirm for the "About <Firm>" → "About" collapse: when the
// firm's first significant word is a generic service word, the text must also
// carry the firm's NEXT significant word (so "Tax Pros Team" names "Tax Pros
// LLC" but "Tax Planning" does not).
function namesFirmForAbout(text: string, firmName?: string): boolean {
  if (!firmName) return namesFirm(text, firmName)
  const s = normWords(text)
  const f = normWords(firmName)
  if (s && f && (s === f || s.replace(/ /g, '') === f.replace(/ /g, ''))) return true
  const firmWords = significantWords(firmName)
  if (!firmWords[0] || !GENERIC_LEAD_WORDS.has(firmWords[0])) return namesFirm(text, firmName)
  const textWords = significantWords(text)
  if (textWords[0] !== firmWords[0]) return false
  return !!firmWords[1] && textWords[1] === firmWords[1]
}

// Does the label mention the firm anywhere (the whole name, or its first
// significant word as a word)?
function containsFirm(label: string, firmName?: string): boolean {
  if (!firmName) return false
  const l = ` ${normWords(label)} `
  const f = normWords(firmName)
  const first = significantWords(firmName)[0]
  return (!!f && l.includes(` ${f} `)) || (!!first && l.includes(` ${first} `))
}

/**
 * Strip SEO-title noise from a nav label: "| Firm Name" segments (keeping the
 * first segment that is NOT the firm name), "- Firm" suffixes, "About Home" →
 * "About", "About <Firm>" → "About" (not for curated labels), and "…your
 * trusted accounting partner" taglines. Never shortens a clean label.
 */
export function cleanNavLabel(raw: string, firmName?: string, opts: { curated?: boolean } = {}): string {
  let label = raw.replace(/\s+/g, ' ').trim()
  if (label.includes('|')) {
    const parts = label.split('|').map((part) => part.trim()).filter((part) => part.length > 0)
    label = parts.find((part) => !namesFirm(part, firmName)) ?? parts[0] ?? ''
  }
  const dash = label.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dash && namesFirm(dash[2], firmName)) label = dash[1].trim()
  label = label.replace(/\s+your\s+(trusted|premier|local|leading|reliable|go-to|preferred)\b.*$/i, '').trim()
  // Never on an operator-curated label: "About Tax Planning" may be exactly
  // what they typed.
  const about = opts.curated ? null : label.match(/^about\s+(.+)$/i)
  if (about && (/^home$/i.test(about[1]) || namesFirmForAbout(about[1], firmName))) label = 'About'
  return label
}

const TRAILING_STOPWORDS = new Set(['and', 'or', 'for', 'the', 'of', 'to', 'with', 'in', 'a', 'an', '&', 'at', 'by', 'on'])

// Cut at a word boundary to <= max chars, dropping dangling stopwords/punctuation.
function truncateLabel(label: string, max: number): string {
  const words = label.split(' ')
  const out: string[] = []
  for (const w of words) {
    if ([...out, w].join(' ').length > max) break
    out.push(w)
  }
  while (out.length > 1 && TRAILING_STOPWORDS.has(out[out.length - 1].toLowerCase().replace(/[,;:]$/, ''))) out.pop()
  return (out.join(' ') || label.slice(0, max)).replace(/[\s,;:–—-]+$/, '')
}

/**
 * Determine the effective label for a sitemap-derived nav item: the page title
 * cleaned of SEO noise; when that is still longer than NAV_LABEL_MAX, the
 * humanized slug ("/services/tax" → "Tax"), else a word-boundary truncation.
 */
function getLabel(entry: SitemapEntry, firmName?: string): string {
  const title = entry.title?.trim() ? cleanNavLabel(entry.title, firmName) : ''
  if (title && title.length <= NAV_LABEL_MAX) return title
  const slug = slugToLabel(entry.url)
  if (!title || slug.length <= NAV_LABEL_MAX) return slug
  return truncateLabel(title, NAV_LABEL_MAX)
}

// Curated (operator-saved) labels are only stripped of SEO noise — never
// shortened — and a label that is already clean (short, no "|", no firm name)
// is left exactly as the operator typed it. The preflight lints the rest.
function cleanCuratedLabels(item: NavItem, firmName?: string): NavItem {
  const clean = item.label.length <= NAV_LABEL_MAX && !item.label.includes('|') && !containsFirm(item.label, firmName)
  return {
    ...item,
    label: clean ? item.label : cleanNavLabel(item.label, firmName, { curated: true }) || item.label,
    ...(item.children ? { children: item.children.map((c) => cleanCuratedLabels(c, firmName)) } : {}),
  }
}

// Dropdown rows wrap inside their menu, so only sentence-length ones are flagged.
export const NAV_DROPDOWN_LABEL_MAX = 50

/**
 * Nav labels that will crowd or overflow the header: any label still carrying
 * a "|", a top-level label longer than NAV_LABEL_MAX, or a dropdown label
 * longer than NAV_DROPDOWN_LABEL_MAX. Returns one operator-facing line each.
 */
export function lintNavLabels(nav: NavJson): string[] {
  const out: string[] = []
  // Two siblings with the same label read as one link twice (Aurora's two
  // "Meet Our Team" pages).
  const lintDuplicates = (items: NavItem[], where: string) => {
    const counts = new Map<string, { label: string; n: number }>()
    for (const i of items) {
      const key = i.label.trim().toLowerCase()
      const c = counts.get(key)
      if (c) c.n++
      else counts.set(key, { label: i.label, n: 1 })
    }
    for (const { label, n } of counts.values()) {
      if (n > 1) out.push(`Nav label "${label}" appears ${n} times ${where} — give each page a distinct label.`)
    }
  }
  const visit = (item: NavItem, depth: number) => {
    const where = depth === 0 ? 'top-level' : 'dropdown'
    const max = depth === 0 ? NAV_LABEL_MAX : NAV_DROPDOWN_LABEL_MAX
    if (item.label.includes('|')) out.push(`Nav label "${item.label}" (${where}) contains "|" — use a short page name.`)
    else if (item.label.length > max)
      out.push(`Nav label "${item.label}" (${where}) is ${item.label.length} characters — keep it to ${max} or fewer.`)
    lintDuplicates(item.children ?? [], `under "${item.label}"`)
    for (const child of item.children ?? []) visit(child, depth + 1)
  }
  lintDuplicates(nav.primary, 'in the top-level menu')
  for (const item of nav.primary) visit(item, 0)
  if (nav.cta) visit(nav.cta, 0)
  return out
}

/**
 * Determine if an entry should be included in the nav.
 * Skip entries with status 'redirect' or 'consolidate'.
 */
function shouldInclude(entry: SitemapEntry): boolean {
  const status = entry.status?.toLowerCase() ?? ''
  return status !== 'redirect' && status !== 'consolidate'
}

/**
 * Determine if a URL is the homepage.
 */
function isHomepage(url: string): boolean {
  return url === '/' || url === ''
}

/**
 * Determine if an entry is a root-level nav item.
 * Root items have no parent or parent is the homepage.
 */
function isRootItem(entry: SitemapEntry): boolean {
  const parent = entry.parent ?? ''
  return parent === '' || parent === '/' || isHomepage(parent)
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Rewrite every clickable nav URL (primary items, nested children, header CTA)
 * that points at the firm's own host into an origin-relative path, so the nav
 * follows the current origin — the Vercel preview before launch, the live
 * domain after — instead of hard-jumping to production. Nav URLs are usually
 * already relative; this is belt-and-suspenders for a crawl-seeded sitemap that
 * carried absolute URLs. `host` is the bare firm host (www stripped) from
 * `siteHost()`. Already-relative / external URLs are left untouched.
 */
export function normalizeNavUrls(nav: NavJson, host: string): NavJson {
  const normItem = (item: NavItem): NavItem => ({
    ...item,
    url: internalizeHref(item.url, host),
    ...(item.children ? { children: item.children.map(normItem) } : {}),
  })
  return {
    ...nav,
    primary: nav.primary.map(normItem),
    ...(nav.cta ? { cta: { ...nav.cta, url: internalizeHref(nav.cta.url, host) } } : {}),
  }
}

export function buildNavJson(
  sitemap: SitemapEntry[],
  curated?: unknown,
  options: { firmName?: string } = {}
): NavJson {
  const { firmName } = options
  // If curated config is provided and passes validation, use it
  if (curated !== null && curated !== undefined) {
    const validated = validateNavJson(curated)
    if (validated) {
      return { ...validated, primary: validated.primary.map((item) => cleanCuratedLabels(item, firmName)) }
    }
    // Validation failed — log warning and fall through to sitemap logic
    console.warn(
      '[nav-json-builder] nav_config failed validation — falling back to sitemap'
    )
  }

  // Filter out redirect/consolidate entries
  const included = sitemap.filter(shouldInclude)

  // Build a map: url → entry, for fast parent lookup
  const entriesByUrl = new Map<string, SitemapEntry>()
  for (const entry of included) {
    if (entry.url) {
      entriesByUrl.set(entry.url, entry)
    }
  }

  // Root items: no parent (or homepage parent). A child whose declared parent
  // doesn't exist is flattened up to root with a warning.
  const rootItems: SitemapEntry[] = []
  for (const entry of included) {
    if (isRootItem(entry)) {
      // Skip homepage itself from primary nav
      if (!isHomepage(entry.url)) rootItems.push(entry)
    } else if (!entriesByUrl.has(entry.parent!)) {
      rootItems.push(entry)
      console.warn(
        `[nav-json-builder] Orphaned child: url="${entry.url}" parent="${entry.parent}" does not exist. Flattening to root.`
      )
    }
  }

  // Recursively attach descendants by parent linkage: primary → secondary →
  // tertiary. Anything nested below tertiary is dropped with a warning. `seen`
  // guards against parent cycles.
  const buildChildren = (
    parentUrl: string,
    depth: number,
    seen: Set<string>
  ): NavItem[] => {
    const kids = included.filter(
      (e) => !isHomepage(e.url) && e.url !== parentUrl && e.parent === parentUrl
    )
    if (kids.length === 0) return []
    if (depth > MAX_NAV_DEPTH) {
      for (const k of kids) {
        console.warn(
          `[nav-json-builder] Nesting below tertiary dropped: url="${k.url}" parent="${parentUrl}".`
        )
      }
      return []
    }
    const out: NavItem[] = []
    for (const child of kids) {
      if (seen.has(child.url)) continue
      seen.add(child.url)
      const grandchildren = buildChildren(child.url, depth + 1, seen)
      out.push({
        label: getLabel(child, firmName),
        url: child.url,
        ...(grandchildren.length > 0 && { children: grandchildren }),
      })
    }
    return out
  }

  const primaryNav: NavItem[] = rootItems.map((root): NavItem => {
    const children = buildChildren(root.url, 1, new Set<string>([root.url]))
    return {
      label: getLabel(root, firmName),
      url: root.url,
      ...(children.length > 0 && { children }),
    }
  })

  return {
    primary: primaryNav,
    // v1: cta is undefined (no header CTA button by default)
  }
}
