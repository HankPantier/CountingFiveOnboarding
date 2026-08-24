// ---------------------------------------------------------------------------
// Nav-driven page hierarchy for the Divi export bridge (see ./README.md).
//
// nav.json is the authoritative site structure — a "Services" dropdown groups
// pages that may not share a URL prefix (/tax-services, /audit-services). This
// derives page parent/child from that tree (not URL prefixes), rewrites nav item
// URLs to the page paths they resolve to, and describes the section pages we
// must synthesize for dropdown parents that have no page of their own.
// ---------------------------------------------------------------------------

import type { NavJson, NavItem } from '@/types/nav-json'
import { toPagePath } from '@/lib/content/deliverable-builder'
import { subPageHeader, cardGridBlock, type Card } from './blocks'

export type NavSection = {
  path: string
  title: string
  children: Array<{ title: string; path: string }>
}

export type NavAnalysis = {
  parentByChildPath: Map<string, string>
  sections: NavSection[]
  resolvedNav: NavJson
}

function slugPath(label: string): string {
  const slug = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `/${slug}` : ''
}

// The page path a nav item points at: its own URL when it's a real internal
// path, otherwise a slug derived from the label (for `#`/empty dropdown parents).
// Returns null for external links (they never become pages).
export function navItemPath(item: NavItem): string | null {
  const raw = (item.url ?? '').trim()
  if (/^https?:\/\//i.test(raw)) return null
  if (raw && raw !== '#') return toPagePath(raw)
  return slugPath(item.label) || null
}

export function analyzeNav(nav: NavJson): NavAnalysis {
  const parentByChildPath = new Map<string, string>()
  const sections: NavSection[] = []

  const walk = (items: NavItem[]): NavItem[] => {
    const resolved: NavItem[] = []
    for (const item of items) {
      const path = navItemPath(item)
      const kids = item.children ?? []
      const resolvedKids = kids.length ? walk(kids) : undefined
      resolved.push({
        label: item.label,
        url: path ?? item.url,
        ...(resolvedKids && resolvedKids.length ? { children: resolvedKids } : {}),
      })

      if (kids.length && path) {
        const childEntries: NavSection['children'] = []
        for (const child of kids) {
          const cp = navItemPath(child)
          if (cp && cp !== path) {
            parentByChildPath.set(cp, path)
            childEntries.push({ title: child.label, path: cp })
          }
        }
        if (childEntries.length) sections.push({ path, title: item.label, children: childEntries })
      }
    }
    return resolved
  }

  const resolvedNav: NavJson = {
    primary: walk(nav.primary),
    ...(nav.cta ? { cta: nav.cta } : {}),
  }

  return { parentByChildPath, sections, resolvedNav }
}

// How deep a path sits in the nav tree (0 = top level). Used to order pages so
// every parent is emitted before its children — what the WP importer needs to
// resolve post_parent.
export function levelOf(path: string, parentByChildPath: Map<string, string>): number {
  let level = 0
  let cur = path
  const seen = new Set<string>()
  while (parentByChildPath.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    cur = parentByChildPath.get(cur)!
    level++
  }
  return level
}

// A minimal Divi landing page for a dropdown section that has no page of its
// own: a page-header + a card grid linking to each child page.
export function buildSectionLandingDivi(section: NavSection): string {
  const cards: Card[] = section.children.map((c) => ({
    title: c.title,
    bodyHtml: `<p><a href="${c.path}">Learn more →</a></p>`,
  }))
  const cols = cards.length >= 4 ? 4 : cards.length <= 1 ? 1 : 3
  return subPageHeader(section.title) + cardGridBlock('', cards, cols)
}
