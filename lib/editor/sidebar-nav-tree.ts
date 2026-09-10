import type { NavItem } from '@/types/nav-json'
import { pageSegments, sortPages, type PageFile } from './page-paths'
import { toPathname } from './nav-urls'

// The Pages sidebar merges two sources: the ordered/nested nav.json (what shows
// in the menu, and in what order) and the flat list of page files (the universe
// of pages). This module maps between the two and partitions pages into
// "in navigation" (rendered in nav order) and "not in navigation".

// Nav url → page repo path, mirroring the /nav route's pagePath so the sidebar's
// "is this page in nav" answer matches what the server acts on. Normalizes
// absolute/host-prefixed urls first. Home ('/') maps to home.md. External or
// unresolvable urls → null.
export function navUrlToPagePath(url: string): string | null {
  const pathname = toPathname(url)
  if (!pathname) return null
  if (pathname === '/') return 'content/pages/home.md'
  const slug = pathname.replace(/^\/+|\/+$/g, '')
  if (!slug) return null
  return 'content/pages/' + slug.replace(/\//g, '--') + '.md'
}

// Page repo path → root-relative url (inverse of navUrlToPagePath). home.md → '/'.
export function pagePathToUrl(path: string): string {
  const segs = pageSegments(path)
  if (segs.length === 1 && segs[0] === 'home') return '/'
  return '/' + segs.join('/')
}

// Title-cased menu label derived from a page file's last segment, used when
// adding a page back into the nav via the show-in-nav toggle.
export function deriveNavLabel(path: string): string {
  const seg = pageSegments(path).pop() ?? ''
  if (seg === 'home') return 'Home'
  return seg
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export type MergedPagesModel = {
  // nav.json primary items, verbatim (nav order + nesting) — seed for toEditItems.
  navPrimary: NavItem[]
  // Page files referenced nowhere in nav, alphabetical — the "Not in navigation"
  // group (each promotable into nav via the eye toggle).
  notInNav: PageFile[]
}

// Partition page files against the nav tree. A page is "in nav" when some nav
// item's url resolves to that existing page file; everything else is "not in nav".
// External/dangling nav items (url resolves to no existing file) reference no page,
// so they never pull a real page out of notInNav.
export function buildMergedPagesModel(
  pageFiles: PageFile[],
  navPrimary: NavItem[]
): MergedPagesModel {
  const existing = new Set(pageFiles.map((f) => f.path))
  const referenced = new Set<string>()
  const walk = (items: NavItem[]) => {
    for (const it of items) {
      const p = navUrlToPagePath(it.url)
      if (p && existing.has(p)) referenced.add(p)
      if (it.children) walk(it.children)
    }
  }
  walk(navPrimary)
  const notInNav = sortPages(pageFiles.filter((f) => !referenced.has(f.path)))
  return { navPrimary, notInNav }
}
