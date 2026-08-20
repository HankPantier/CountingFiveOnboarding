// ---------------------------------------------------------------------------
// Internal-link validation — pure, sync, no I/O. Run at package time so a
// page linking to /services/old-offering (typo, renamed slug, hallucinated
// path) is flagged before the deliverable ships. Warn-only: broken internal
// links are a quality issue, not a packaging blocker.
// ---------------------------------------------------------------------------

import { toSitePath } from './url-path'

type PageForLinkCheck = {
  page_url: string
  content_markdown: string | null
  internal_links: unknown
}

const MD_LINK_RE = /\[[^\]]*\]\((\/[^)\s#?]*)/g
const ASSET_EXT_RE = /\.(png|jpe?g|webp|gif|svg|pdf|docx?|xlsx?|zip|xml|txt|ico)$/i

function isCheckable(path: string): boolean {
  if (ASSET_EXT_RE.test(path)) return false
  // Blog posts (/resources/<slug>) are drafted outside the confirmed sitemap.
  if (/^\/resources\/.+/.test(path)) return false
  return true
}

// Set of known site paths for the confirmed sitemap (home is always real).
function buildKnownPaths(sitemapUrls: Iterable<string>): Set<string> {
  const known = new Set<string>()
  for (const url of sitemapUrls) {
    const p = toSitePath(url)
    if (p) known.add(p)
  }
  known.add('/')
  return known
}

// Keep only internal_links that resolve to a real, checkable sitemap path —
// dropping hallucinated/typo paths at generation time so they never ship in the
// deliverable. Non-sitemap-constrained targets (/resources/* blog posts, asset
// files) are kept; malformed or non-root-relative entries are dropped.
export function filterKnownInternalLinks<T extends { url?: unknown }>(
  links: T[],
  sitemapUrls: Iterable<string>
): T[] {
  const known = buildKnownPaths(sitemapUrls)
  return links.filter((link) => {
    if (typeof link?.url !== 'string' || !link.url.startsWith('/')) return false
    const target = toSitePath(link.url)
    if (!target) return false
    if (!isCheckable(target)) return true
    return known.has(target)
  })
}

export function validateInternalLinks(
  pages: PageForLinkCheck[],
  sitemapUrls: Iterable<string>
): string[] {
  const known = buildKnownPaths(sitemapUrls)

  const warnings: string[] = []
  const seen = new Set<string>()
  const warn = (page: string, target: string, source: string) => {
    const key = `${page}→${target}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push(`${page}: links to ${target} (${source}) which is not in the confirmed sitemap`)
  }

  for (const page of pages) {
    const links = Array.isArray(page.internal_links)
      ? (page.internal_links as Array<{ url?: unknown }>)
      : []
    for (const link of links) {
      if (typeof link?.url !== 'string' || !link.url.startsWith('/')) continue
      const target = toSitePath(link.url)
      if (target && isCheckable(target) && !known.has(target)) {
        warn(page.page_url, target, 'internal_links metadata')
      }
    }

    for (const match of (page.content_markdown ?? '').matchAll(MD_LINK_RE)) {
      const target = toSitePath(match[1])
      if (target && isCheckable(target) && !known.has(target)) {
        warn(page.page_url, target, 'body link')
      }
    }
  }
  return warnings
}
