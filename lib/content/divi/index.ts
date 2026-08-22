// ---------------------------------------------------------------------------
// Divi/WordPress export bridge — orchestrator.
//
// Throwaway stop-gap that turns a client's live pages into a WordPress import
// bundle for the shared Divi boilerplate site. See ./README.md for the full
// rationale and a one-move removal guide. Produces a zip containing:
//   - <site>.wxr                 all pages (Divi shortcode) + primary nav menu
//   - <site>-divi-library.json   per-client Header (Client Center) + Footer
//   - README.txt                 import + Theme Builder steps
//
// Source-neutral: callers hand it a prepared DiviPageInput[] (the editor route
// maps live repo `.md` files via from-frontmatter.ts). Page parent hierarchy is
// derived from the URL paths, so no separate sitemap is needed.
// ---------------------------------------------------------------------------

import type { BrandJson } from '@/types/brand-json'
import type { ClientCenterJson } from '@/types/client-center'
import type { NavJson } from '@/types/nav-json'
import { toPagePath, siteHost } from '@/lib/content/deliverable-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import { buildPageDivi, collectPageQueries, type DiviPageInput } from './page'
import { resolveImageUrls } from './images'
import { buildWxr, type WxrPage } from './wxr'
import { buildDiviLibrary } from './library'
import { buildReadme } from './readme'

export type { DiviPageInput } from './page'

export type DiviExportInput = {
  firmName: string
  websiteUrl: string
  pages: DiviPageInput[]
  brand: BrandJson
  clientCenter: ClientCenterJson
  nav: NavJson
  logoUrl: string | null
  pexelsApiKey: string
  dateGmt: string // "YYYY-MM-DD HH:mm:ss" — passed in so the builder stays pure
}

export type DiviExportResult = {
  zip: Buffer
  filenameBase: string
}

function slugFor(path: string): string {
  const last = path.replace(/\/+$/, '').split('/').pop() || ''
  return last || 'home'
}

// The parent page path is the nearest existing ancestor: drop the last URL
// segment and, if a page lives there, that's the parent. e.g. /services/cfo →
// /services (if present), else root.
function parentPathFor(path: string, existing: Set<string>): string | null {
  if (path === '/') return null
  const segments = path.split('/').filter(Boolean)
  for (let i = segments.length - 1; i >= 1; i--) {
    const candidate = '/' + segments.slice(0, i).join('/')
    if (existing.has(candidate)) return candidate
  }
  return null
}

export async function buildDiviExport(input: DiviExportInput): Promise<DiviExportResult> {
  // Home first, then everything else by URL for a stable, readable import order.
  const ordered = [...input.pages].sort((a, b) => {
    const pa = toPagePath(a.page_url)
    const pb = toPagePath(b.page_url)
    if (pa === '/') return -1
    if (pb === '/') return 1
    return pa.localeCompare(pb)
  })

  // Stable post IDs so nav menu items and page parents can reference them.
  const pageIdByPath = new Map<string, number>()
  ordered.forEach((p, i) => pageIdByPath.set(toPagePath(p.page_url), 100 + i))
  const existingPaths = new Set(pageIdByPath.keys())

  // Resolve every image query once, deduped across the whole site.
  const allQueries = ordered.flatMap((p) => collectPageQueries(p))
  const imageUrls = await resolveImageUrls(allQueries, input.pexelsApiKey)

  const wxrPages: WxrPage[] = ordered.map((p) => {
    const path = toPagePath(p.page_url)
    const parentPath = parentPathFor(path, existingPaths)
    return {
      title: p.page_title,
      path,
      slug: slugFor(path),
      postId: pageIdByPath.get(path)!,
      parentId: (parentPath && pageIdByPath.get(parentPath)) || 0,
      content: buildPageDivi(p, imageUrls, input.websiteUrl),
    }
  })

  const wxr = buildWxr({
    siteTitle: input.firmName || siteHost(input.websiteUrl),
    siteUrl: input.websiteUrl,
    pages: wxrPages,
    nav: input.nav,
    dateGmt: input.dateGmt,
  })

  const library = buildDiviLibrary({
    brand: input.brand,
    clientCenter: input.clientCenter,
    nav: input.nav,
    logoUrl: input.logoUrl,
    dateGmt: input.dateGmt,
  })

  const filenameBase =
    (siteHost(input.websiteUrl) || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')

  const readme = buildReadme({
    firmName: input.firmName,
    filenameBase,
    pageCount: wxrPages.length,
    imageCount: imageUrls.size,
    hasLogo: !!input.logoUrl,
  })

  const zip = await assembleZip([
    { path: `${filenameBase}.wxr`, content: wxr },
    { path: `${filenameBase}-divi-library.json`, content: library },
    { path: 'README.txt', content: readme },
  ])

  return { zip, filenameBase }
}
