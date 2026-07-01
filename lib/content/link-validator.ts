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

export function validateInternalLinks(
  pages: PageForLinkCheck[],
  sitemapUrls: Iterable<string>
): string[] {
  const known = new Set<string>()
  for (const url of sitemapUrls) {
    const p = toSitePath(url)
    if (p) known.add(p)
  }
  known.add('/') // home is always a real page

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
