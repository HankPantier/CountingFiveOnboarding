// Discover candidate team headshots on a client's live website so a rep can
// pull them into onboarding instead of sourcing every photo by hand. Server-only
// (the orchestrator fetches over the network via the audit engine's SSRF-guarded
// safeGet). The parse/rank helpers are pure and unit-testable.
//
// This never auto-commits a photo — it surfaces candidates + a best-guess
// suggestion per member; the rep confirms each assignment in the UI.
import * as cheerio from 'cheerio'
import { safeGet, normalizeUrl, sameDomain } from '@/lib/audit/crawl'

export type HeadshotCandidate = {
  imageUrl: string
  altText: string | null
  /** Figcaption / nearest heading text near the image — a naming hint. */
  nearbyName: string | null
  filename: string
  width: number | null
  height: number | null
}

export type ScrapeResult = {
  candidates: HeadshotCandidate[]
  scannedPages: string[]
  warnings: string[]
}

// Anchor href/text that hints at a team/about page. Covers the common "About"
// synonyms firms actually use for their roster page — "who we are", "our firm",
// "professionals", "principals/shareholders" — not just literal team/about.
const TEAM_LINK_RE = /team|about|our-people|our-team|staff|leadership|\bmeet\b|people|attorneys|advisors|partners|principals|shareholders|founders|professionals|who[- ]?we[- ]?are|our[- ]?firm|the[- ]?firm|\bbios?\b/i
// Image filenames/paths that are almost never a person's headshot.
const SKIP_IMG_RE = /logo|icon|favicon|sprite|badge|banner|placeholder|spacer|pixel|1x1|loading/i
const MAX_TEAM_PAGES = 4
const MAX_CANDIDATES = 40
// Declared dimensions below this are icons/pixels, not headshots.
const MIN_DIMENSION = 60

function parseIntOrNull(v: string | undefined): number | null {
  if (!v) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function basename(url: string): string {
  try {
    const path = new URL(url).pathname
    return (path.split('/').pop() || path).toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/** True when a URL's path looks like a team/about page — used to pick team-like
 * pages out of an already-crawled inventory (belt-and-suspenders to homepage
 * link discovery). Shares TEAM_LINK_RE so the two never drift. */
export function looksLikeTeamPageUrl(url: string): boolean {
  try {
    return TEAM_LINK_RE.test(new URL(url).pathname)
  } catch {
    return TEAM_LINK_RE.test(url)
  }
}

/** Same-domain URLs on the page whose href or link text looks like a team/about
 * page. Pure — operates on already-fetched HTML. */
export function findTeamPages(html: string, pageUrl: string): string[] {
  let baseDomain: string
  try {
    baseDomain = new URL(pageUrl).host
  } catch {
    return []
  }
  const $ = cheerio.load(html)
  const urls: string[] = []
  const seen = new Set<string>()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return
    const full = normalizeUrl(href, pageUrl)
    if (!full || !sameDomain(full, baseDomain)) return
    if (!TEAM_LINK_RE.test(href) && !TEAM_LINK_RE.test($(el).text())) return
    if (seen.has(full)) return
    seen.add(full)
    urls.push(full)
  })
  return urls
}

/** Candidate headshot images on a single page, with naming context. Pure. */
export function extractHeadshotCandidates(html: string, pageUrl: string): HeadshotCandidate[] {
  const $ = cheerio.load(html)
  const out: HeadshotCandidate[] = []
  const seen = new Set<string>()
  $('img').each((_, el) => {
    const $el = $(el)

    // Resolve the best source: largest srcset entry, then src, then lazy attrs.
    let raw: string | null = null
    const srcset = $el.attr('srcset') || $el.attr('data-srcset')
    if (srcset) {
      let best: { url: string; weight: number } | null = null
      for (const entry of srcset.split(',')) {
        const [url, descriptor] = entry.trim().split(/\s+/)
        if (!url) continue
        const weight = descriptor ? parseInt(descriptor, 10) || 0 : 0
        if (!best || weight >= best.weight) best = { url, weight }
      }
      if (best) raw = best.url
    }
    if (!raw) raw = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || null
    if (!raw || raw.startsWith('data:')) return

    const abs = normalizeUrl(raw, pageUrl)
    if (!abs) return
    const filename = basename(abs)
    if (SKIP_IMG_RE.test(filename) || SKIP_IMG_RE.test(abs)) return
    const width = parseIntOrNull($el.attr('width'))
    const height = parseIntOrNull($el.attr('height'))
    if ((width !== null && width < MIN_DIMENSION) || (height !== null && height < MIN_DIMENSION)) return
    if (seen.has(abs)) return
    seen.add(abs)

    // Naming hint: figcaption, else the nearest heading walking up a few levels.
    let nearbyName: string | null = null
    const caption = $el.closest('figure').find('figcaption').first().text().trim()
    if (caption) {
      nearbyName = caption
    } else {
      let node = $el.parent()
      for (let i = 0; i < 4 && node.length; i++) {
        const heading = node.find('h1,h2,h3,h4,h5,h6').first().text().trim()
        if (heading) {
          nearbyName = heading
          break
        }
        node = node.parent()
      }
    }

    out.push({
      imageUrl: abs,
      altText: ($el.attr('alt') ?? '').trim() || null,
      nearbyName,
      filename,
      width,
      height,
    })
  })
  return out
}

// Name tokens for matching: drop credentials after the first comma, lowercase,
// split on non-alphanumerics, keep tokens ≥2 chars. Mirrors injectTeamPhotos'
// leading-name-portion convention.
function nameTokens(name: string): string[] {
  return name
    .split(',')[0]
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

function tokenOverlap(tokens: string[], haystack: string): number {
  const hay = new Set(haystack.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  let score = 0
  for (const t of tokens) if (hay.has(t)) score++
  return score
}

/** Best-guess candidate imageUrl per member by name/alt/filename overlap. Never
 * auto-commits — the rep confirms. Pure. */
export function suggestCandidatesByName(
  members: { name: string }[],
  candidates: HeadshotCandidate[]
): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const member of members) {
    const tokens = nameTokens(member.name)
    let best: { url: string; score: number } | null = null
    if (tokens.length > 0) {
      for (const c of candidates) {
        const score = tokenOverlap(tokens, `${c.nearbyName ?? ''} ${c.altText ?? ''} ${c.filename}`)
        if (score > 0 && (!best || score > best.score)) best = { url: c.imageUrl, score }
      }
    }
    result[member.name] = best?.url ?? null
  }
  return result
}

function isHtml200(res: Awaited<ReturnType<typeof safeGet>>): boolean {
  return !!res && res.status === 200 && res.contentType.includes('text/html')
}

/** Fetch the homepage, discover team/about pages, and collect candidate
 * headshots across them. SSRF-guarded via safeGet on every request. */
export async function scrapeTeamHeadshots(websiteUrl: string): Promise<ScrapeResult> {
  const scannedPages: string[] = []
  const warnings: string[] = []
  const candidates: HeadshotCandidate[] = []
  const seen = new Set<string>()

  const collect = (list: HeadshotCandidate[]) => {
    for (const c of list) {
      if (candidates.length >= MAX_CANDIDATES) break
      if (seen.has(c.imageUrl)) continue
      seen.add(c.imageUrl)
      candidates.push(c)
    }
  }

  const home = await safeGet(websiteUrl)
  if (!isHtml200(home)) {
    return { candidates: [], scannedPages, warnings: [`Could not load ${websiteUrl}`] }
  }
  scannedPages.push(home!.finalUrl)
  collect(extractHeadshotCandidates(home!.body, home!.finalUrl))

  const teamPages = findTeamPages(home!.body, home!.finalUrl)
    .filter((u) => u !== home!.finalUrl)
    .slice(0, MAX_TEAM_PAGES)

  for (const url of teamPages) {
    if (candidates.length >= MAX_CANDIDATES) break
    const res = await safeGet(url)
    if (!isHtml200(res)) {
      warnings.push(`Couldn't read ${url}`)
      continue
    }
    scannedPages.push(res!.finalUrl)
    collect(extractHeadshotCandidates(res!.body, res!.finalUrl))
  }

  return { candidates, scannedPages, warnings }
}
