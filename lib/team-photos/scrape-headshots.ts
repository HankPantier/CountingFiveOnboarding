// Discover candidate team headshots on a client's live website so a rep can
// pull them into onboarding instead of sourcing every photo by hand. Server-only
// (the orchestrator fetches over the network via the audit engine's SSRF-guarded
// safeGet). The parse helpers here are pure and unit-testable; the pure
// name-matching / classification / ranking logic lives in ./match (client-safe).
//
// This never auto-commits a photo — it surfaces candidates + a best-guess
// suggestion per member; the rep confirms each assignment in the UI.
import * as cheerio from 'cheerio'
import { safeGet, normalizeUrl, sameDomain } from '@/lib/audit/crawl'
import { TEAM_LINK_RE, isLikelyHeadshot, type HeadshotCandidate } from './match'

// Re-export the pure match/classify/rank helpers so existing importers (the
// discover route, auto-pull, tests) keep a single import surface.
export {
  looksLikeTeamPageUrl,
  slugTokens,
  overlapCount,
  nameTokens,
  tokenOverlap,
  isLikelyHeadshot,
  rankCandidatesForMember,
  matchHeadshotsToMembers,
  suggestCandidatesByName,
} from './match'
export type { HeadshotCandidate, MatchConfidence, MemberMatch } from './match'

export type ScrapeResult = {
  candidates: HeadshotCandidate[]
  scannedPages: string[]
  warnings: string[]
}

// Image filenames/paths that are almost never a person's headshot. Cheap
// first-pass skip at extraction time; isLikelyHeadshot (in ./match) does the
// stricter classification when candidates are collected.
const SKIP_IMG_RE = /logo|icon|favicon|sprite|badge|banner|placeholder|spacer|pixel|1x1|loading/i
const MAX_TEAM_PAGES = 4
// Individual bio/profile pages (e.g. /team/jane-doe) linked from a team listing
// — a bio page holds one person, so its headshot matches with high confidence.
const MAX_BIO_PAGES = 12
const MAX_CANDIDATES = 40
// Declared dimensions below this are icons/pixels, not headshots.
const MIN_DIMENSION = 60
// Paths that are children of a team page but are not a person's bio.
const SKIP_BIO_PATH_RE =
  /\.(pdf|jpe?g|png|gif|svg|webp|docx?|xlsx?)$|\/(contact|privacy|terms|search|category|categories|tag|tags|page|blog|news|events?|services?|resources?)(\/|$)/i

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

/** Individual bio/profile pages linked from a team listing: same-domain links
 * exactly one path segment deeper than the team page (e.g. /who-we-are →
 * /who-we-are/jane-doe). Pure. Lives here (the lowest-level page-analysis
 * module) so team-social can reuse it without a circular import. */
export function findBioPages(html: string, teamPageUrl: string): string[] {
  let base: URL
  try {
    base = new URL(teamPageUrl)
  } catch {
    return []
  }
  const basePath = base.pathname.replace(/\/+$/, '')
  if (!basePath) return [] // a homepage/root has no meaningful bio sub-tree

  const $ = cheerio.load(html)
  const out: string[] = []
  const seen = new Set<string>()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    const full = normalizeUrl(href, teamPageUrl)
    if (!full || !sameDomain(full, base.host)) return
    let path: string
    try {
      path = new URL(full).pathname.replace(/\/+$/, '')
    } catch {
      return
    }
    if (!path.startsWith(`${basePath}/`)) return
    const rest = path.slice(basePath.length + 1)
    if (!rest || rest.includes('/')) return // exactly one segment deeper
    if (SKIP_BIO_PATH_RE.test(path)) return
    if (seen.has(full)) return
    seen.add(full)
    out.push(full)
  })
  return out
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
      sourcePageUrl: pageUrl,
    })
  })
  return out
}

function isHtml200(res: Awaited<ReturnType<typeof safeGet>>): boolean {
  return !!res && res.status === 200 && res.contentType.includes('text/html')
}

/** Fetch the homepage, discover team/about pages, and collect candidate
 * headshots across them. SSRF-guarded via safeGet on every request. Only images
 * that pass isLikelyHeadshot are kept, so the 40-cap fills with real faces (not
 * logos/banners/blog art) and downstream matching/auto-pull stay clean. */
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
      if (!isLikelyHeadshot(c)) continue
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

  // Individual bio pages linked from a team listing — where a single portrait
  // maps unambiguously to one person. Collected while scanning team pages, then
  // followed for high-confidence matches.
  const bioCandidates = new Set<string>()
  for (const url of teamPages) {
    if (candidates.length >= MAX_CANDIDATES) break
    const res = await safeGet(url)
    if (!isHtml200(res)) {
      warnings.push(`Couldn't read ${url}`)
      continue
    }
    scannedPages.push(res!.finalUrl)
    collect(extractHeadshotCandidates(res!.body, res!.finalUrl))
    for (const b of findBioPages(res!.body, res!.finalUrl)) bioCandidates.add(b)
  }

  const bioTargets = [...bioCandidates]
    .filter((u) => !scannedPages.includes(u))
    .slice(0, MAX_BIO_PAGES)
  for (const url of bioTargets) {
    if (candidates.length >= MAX_CANDIDATES) break
    const res = await safeGet(url)
    if (!isHtml200(res)) continue
    scannedPages.push(res!.finalUrl)
    collect(extractHeadshotCandidates(res!.body, res!.finalUrl))
  }

  return { candidates, scannedPages, warnings }
}
