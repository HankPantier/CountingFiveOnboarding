// Pure. The header call-to-action button every packaged site ships with.
//
// Styling review 3 (F1): only one live site had a header CTA and no hero had
// a button, so above the fold the only conversion element was the floating
// "Contact" pill. The package assembler now turns nav.cta on by default; an
// operator-set CTA (nav curation / curated nav_config) always wins.
//
// First deploy only, by construction: content/nav.json is in
// SITE_CONFIG_PATHS (deploy-plan.ts), which only the FIRST deploy writes —
// after that nav.json is the site's config, owned by the NavEditor. So an
// operator who removes the CTA in the NavEditor keeps it removed through
// every later re-package (the re-packaged nav.json is skipped as
// 'site-config'); nav-cta.test.ts pins that invariant. The template (2026.09.5+) also
// uses nav.cta as the hero's primary button and hides a childless primary
// item that points at the same page, so "Contact" is not shown twice.
import type { NavJson } from '@/types/nav-json'
import { toPagePath } from '@/lib/content/deliverable-builder'

export const DEFAULT_NAV_CTA_LABEL = 'Schedule a consultation'
export const DEFAULT_NAV_CTA_URL = '/contact'

type SitemapLike = { url: string; status?: string }

const CONTACT_PATH = /^\/(?:[^/]+\/)*contact(?:-us)?$/i

/**
 * The site's contact page path from the confirmed sitemap (shortest
 * `/contact` or `/contact-us`-style path wins), else `/contact` — which the
 * template's contact drawer serves even without a page.
 */
export function contactPathFromSitemap(sitemap: readonly SitemapLike[]): string {
  const paths = sitemap
    .filter((e) => !['redirect', 'consolidate'].includes((e.status ?? '').toLowerCase()))
    .map((e) => toPagePath(e.url))
    .filter((p) => CONTACT_PATH.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)
  return paths[0] ?? DEFAULT_NAV_CTA_URL
}

/** nav with a header CTA: the existing one when it has a label and url, else the default. */
export function withDefaultNavCta(nav: NavJson, sitemap: readonly SitemapLike[]): NavJson {
  if (nav.cta?.label?.trim() && nav.cta?.url?.trim()) return nav
  return { ...nav, cta: { label: DEFAULT_NAV_CTA_LABEL, url: contactPathFromSitemap(sitemap) } }
}
