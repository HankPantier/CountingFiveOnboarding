// ---------------------------------------------------------------------------
// Sitemap model for the Divi export bridge (see ./README.md).
//
// One structure describes the site exactly as the WXR imports it — menu tree in
// nav order, pages left out of the nav, WordPress parents and permalinks — and
// feeds all three sitemap renderers (PDF directory, SVG/PNG schematic). It is
// built from the same records buildDiviExport hands to the WXR, so the reference
// documents can't drift from what actually imports.
// ---------------------------------------------------------------------------

import type { NavItem, NavJson } from '@/types/nav-json'
import { sortPages } from '@/lib/editor/page-paths'
import { navUrlToPagePath } from '@/lib/editor/sidebar-nav-tree'
import type { DiviPageSeo } from './page'

export type SitemapNodeKind = 'page' | 'synthesized-section' | 'synthesized-home' | 'custom-link'

export type SitemapNode = {
  title: string
  path: string // site path, or the raw url for a custom link
  wpUrl: string // permalink WordPress gives the page once nested ('' for custom links)
  parentTitle: string | null // WordPress parent page (null = top level)
  menuPosition: string | null // "1", "1.2", "1.2.1" — null = not in the menu
  kind: SitemapNodeKind
  seo: DiviPageSeo
  children: SitemapNode[]
}

export type SitemapModel = {
  firmName: string
  generatedAt: string
  home: SitemapNode
  menu: SitemapNode[]
  notInNav: SitemapNode[]
  cta: { label: string; url: string } | null
  navConfigured: boolean
  counts: { pages: number; inMenu: number; notInNav: number; synthesized: number }
}

// One exported page as the orchestrator sees it.
export type SitemapPageRec = {
  path: string
  title: string // the WP page title
  synthesized: 'section' | 'home' | null
  parentPath: string | null // WP post_parent page path
  seo?: DiviPageSeo
}

const EMPTY_SEO: DiviPageSeo = { metaTitle: '', metaDescription: '', targetKeyword: '' }

function slugOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || ''
}

export function buildSitemapModel(input: {
  firmName: string
  generatedAt: string
  pages: SitemapPageRec[]
  nav: NavJson // resolved: internal urls already rewritten to page paths
}): SitemapModel {
  const byPath = new Map(input.pages.map((p) => [p.path, p]))

  // WordPress permalink = parent permalink + own slug (nesting rewrites child URLs).
  const wpUrlCache = new Map<string, string>()
  const wpUrlOf = (path: string, seen = new Set<string>()): string => {
    const cached = wpUrlCache.get(path)
    if (cached !== undefined) return cached
    if (path === '/') return '/'
    const rec = byPath.get(path)
    const parent = rec?.parentPath
    const base = parent && !seen.has(parent) ? wpUrlOf(parent, new Set(seen).add(path)) : '/'
    const url = `${base.replace(/\/+$/, '')}/${slugOf(path)}`
    wpUrlCache.set(path, url)
    return url
  }

  const kindOf = (rec: SitemapPageRec): SitemapNodeKind =>
    rec.synthesized === 'section' ? 'synthesized-section' : rec.synthesized === 'home' ? 'synthesized-home' : 'page'

  const pageNode = (rec: SitemapPageRec, menuPosition: string | null, children: SitemapNode[] = []): SitemapNode => ({
    title: rec.title,
    path: rec.path,
    wpUrl: wpUrlOf(rec.path),
    parentTitle: rec.parentPath ? (byPath.get(rec.parentPath)?.title ?? null) : null,
    menuPosition,
    kind: kindOf(rec),
    seo: rec.seo ?? EMPTY_SEO,
    children,
  })

  const inMenu = new Set<string>()
  const walk = (items: NavItem[], prefix: string): SitemapNode[] =>
    items.map((item, i) => {
      const pos = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      const children = item.children?.length ? walk(item.children, pos) : []
      const rec = byPath.get(item.url)
      if (rec) {
        inMenu.add(rec.path)
        // The menu label is what the visitor sees, so it names the node.
        return { ...pageNode(rec, pos, children), title: item.label || rec.title }
      }
      return {
        title: item.label,
        path: item.url,
        wpUrl: '',
        parentTitle: null,
        menuPosition: pos,
        kind: 'custom-link' as const,
        seo: EMPTY_SEO,
        children,
      }
    })
  const menu = walk(input.nav.primary, '')

  const homeRec = byPath.get('/')
  const home: SitemapNode = homeRec
    ? pageNode(homeRec, null)
    : { title: 'Home', path: '/', wpUrl: '/', parentTitle: null, menuPosition: null, kind: 'synthesized-home', seo: EMPTY_SEO, children: [] }

  // Same order as the sidebar's "Not in navigation" group (segment-wise by file).
  const loose = input.pages.filter((p) => p.path !== '/' && !inMenu.has(p.path))
  const notInNav = sortPages(loose.map((p) => ({ path: navUrlToPagePath(p.path) ?? p.path, rec: p }))).map((x) =>
    pageNode(x.rec, null)
  )

  return {
    firmName: input.firmName,
    generatedAt: input.generatedAt,
    home,
    menu,
    notInNav,
    cta: input.nav.cta ?? null,
    navConfigured: input.nav.primary.length > 0,
    counts: {
      pages: input.pages.length,
      inMenu: inMenu.size,
      notInNav: notInNav.length,
      synthesized: input.pages.filter((p) => p.synthesized).length,
    },
  }
}

// Page paths in sidebar order: home, the menu depth-first, then not-in-nav pages.
// Drives each page's WordPress menu_order.
export function sidebarOrder(model: SitemapModel): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (path: string) => {
    if (!seen.has(path)) {
      seen.add(path)
      out.push(path)
    }
  }
  push('/')
  const walk = (nodes: SitemapNode[]) => {
    for (const n of nodes) {
      if (n.kind !== 'custom-link') push(n.path)
      walk(n.children)
    }
  }
  walk(model.menu)
  for (const n of model.notInNav) push(n.path)
  return out
}

// Flatten the menu tree with depth, for list renderers.
export function flattenMenu(nodes: SitemapNode[], depth = 0): Array<{ node: SitemapNode; depth: number }> {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flattenMenu(n.children, depth + 1)])
}
