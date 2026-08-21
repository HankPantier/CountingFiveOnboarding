// ---------------------------------------------------------------------------
// Divi/WordPress export bridge — orchestrator.
//
// Throwaway stop-gap that turns a client's generated pages into a WordPress
// import bundle for the shared Divi boilerplate site. See ./README.md for the
// full rationale and a one-move removal guide. Produces a zip containing:
//   - <site>.wxr                 all pages (Divi shortcode) + primary nav menu
//   - <site>-divi-library.json   per-client Header (Client Center) + Footer
//   - README.txt                 import + Theme Builder steps
// ---------------------------------------------------------------------------

import type { Database } from '@/types/database'
import type { BrandJson } from '@/types/brand-json'
import type { ClientCenterJson } from '@/types/client-center'
import type { NavJson } from '@/types/nav-json'
import type { SitemapEntry } from '@/lib/content/nav-json-builder'
import { toPagePath, siteHost } from '@/lib/content/deliverable-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import { buildPageDivi, collectPageQueries, type DiviPageInput } from './page'
import { resolveImageUrls } from './images'
import { buildWxr, type WxrPage } from './wxr'
import { buildDiviLibrary } from './library'
import { buildReadme } from './readme'

type GeneratedPageRow = Database['public']['Tables']['generated_pages']['Row']

export type DiviExportInput = {
  firmName: string
  websiteUrl: string
  pages: GeneratedPageRow[]
  sitemap: SitemapEntry[]
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

function slugFor(page: GeneratedPageRow): string {
  const path = toPagePath(page.page_url)
  const last = path.replace(/\/+$/, '').split('/').pop() || ''
  return last || 'home'
}

function toPageInput(page: GeneratedPageRow): DiviPageInput {
  return {
    page_title: page.page_title,
    page_url: page.page_url,
    hero_block: page.hero_block,
    hero_variant: page.hero_variant,
    hero_image_alt: page.hero_image_alt,
    hero_subhead: page.hero_subhead,
    hero_image_query: page.hero_image_query,
    content_markdown: page.content_markdown,
    faq_block: page.faq_block,
    cta: null,
  }
}

export async function buildDiviExport(input: DiviExportInput): Promise<DiviExportResult> {
  // Only ship pages that actually generated content.
  const usable = input.pages.filter(
    (p) => p.generation_status === 'complete' && p.content_markdown
  )

  // Home first, then everything else by URL for a stable, readable import order.
  const ordered = [...usable].sort((a, b) => {
    const pa = toPagePath(a.page_url)
    const pb = toPagePath(b.page_url)
    if (pa === '/') return -1
    if (pb === '/') return 1
    return pa.localeCompare(pb)
  })

  // Stable post IDs so nav menu items and page parents can reference them.
  const pageIdByPath = new Map<string, number>()
  ordered.forEach((p, i) => pageIdByPath.set(toPagePath(p.page_url), 100 + i))

  // Parent path per page from the confirmed sitemap.
  const parentByPath = new Map<string, string>()
  for (const entry of input.sitemap) {
    if (entry.parent) parentByPath.set(toPagePath(entry.url), toPagePath(entry.parent))
  }

  // Resolve every image query once, deduped across the whole site.
  const allQueries = ordered.flatMap((p) => collectPageQueries(toPageInput(p)))
  const imageUrls = await resolveImageUrls(allQueries, input.pexelsApiKey)

  const wxrPages: WxrPage[] = ordered.map((p) => {
    const path = toPagePath(p.page_url)
    const parentPath = parentByPath.get(path)
    return {
      title: p.page_title,
      path,
      slug: slugFor(p),
      postId: pageIdByPath.get(path)!,
      parentId: (parentPath && pageIdByPath.get(parentPath)) || 0,
      content: buildPageDivi(toPageInput(p), imageUrls, input.websiteUrl),
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

  const filenameBase = (siteHost(input.websiteUrl) || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')

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
