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
import { analyzeNav, levelOf, buildSectionLandingDivi, type NavSection } from './hierarchy'

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

type PageRec = { path: string; title: string; real?: DiviPageInput; section?: NavSection }

export async function buildDiviExport(input: DiviExportInput): Promise<DiviExportResult> {
  // nav.json is the authoritative structure: parent/child + which section pages
  // must be synthesized, plus a nav with URLs rewritten to real page paths.
  const { parentByChildPath, sections, resolvedNav } = analyzeNav(input.nav)

  const realByPath = new Map<string, DiviPageInput>()
  for (const p of input.pages) realByPath.set(toPagePath(p.page_url), p)

  // A dropdown parent with no page of its own gets a synthesized landing page so
  // its children have something to nest under and the section is navigable.
  const recs: PageRec[] = input.pages.map((p) => ({
    path: toPagePath(p.page_url),
    title: p.page_title,
    real: p,
  }))
  for (const s of sections) {
    if (!realByPath.has(s.path)) recs.push({ path: s.path, title: s.title, section: s })
  }

  // Dedup by path (first wins — real pages are added first), then order home →
  // shallow → deep so every parent precedes its children (WP importer needs it).
  const seen = new Set<string>()
  const uniqueRecs = recs.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))
  uniqueRecs.sort((a, b) => {
    if (a.path === '/') return -1
    if (b.path === '/') return 1
    const la = levelOf(a.path, parentByChildPath)
    const lb = levelOf(b.path, parentByChildPath)
    return la !== lb ? la - lb : a.path.localeCompare(b.path)
  })

  // Stable post IDs so nav menu items and page parents can reference them.
  const pageIdByPath = new Map<string, number>()
  uniqueRecs.forEach((r, i) => pageIdByPath.set(r.path, 100 + i))
  const allPaths = new Set(pageIdByPath.keys())

  const parentIdFor = (path: string): number => {
    const navParent = parentByChildPath.get(path)
    if (navParent && pageIdByPath.has(navParent)) return pageIdByPath.get(navParent)!
    const urlParent = parentPathFor(path, allPaths) // fallback: URL-prefix nesting
    return (urlParent && pageIdByPath.get(urlParent)) || 0
  }

  // Resolve every image query once, deduped across the real pages.
  const allQueries = uniqueRecs.filter((r) => r.real).flatMap((r) => collectPageQueries(r.real!))
  const imageUrls = await resolveImageUrls(allQueries, input.pexelsApiKey)

  const wxrPages: WxrPage[] = uniqueRecs.map((r) => ({
    title: r.title,
    path: r.path,
    slug: slugFor(r.path),
    postId: pageIdByPath.get(r.path)!,
    parentId: parentIdFor(r.path),
    content: r.real
      ? buildPageDivi(r.real, imageUrls, input.websiteUrl)
      : buildSectionLandingDivi(r.section!),
  }))

  const wxr = buildWxr({
    siteTitle: input.firmName || siteHost(input.websiteUrl),
    siteUrl: input.websiteUrl,
    pages: wxrPages,
    nav: resolvedNav,
    dateGmt: input.dateGmt,
  })

  const library = buildDiviLibrary({
    brand: input.brand,
    clientCenter: input.clientCenter,
    nav: resolvedNav,
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
