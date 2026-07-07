import type { NavItem, NavJson } from '@/types/nav-json'

// Editor-side nav item. Carries two fields that are NOT part of the public
// nav.json contract and are stripped before writing:
//  - `slug`: the item's own path segment; a nested item's url is parent + slug.
//  - `originalUrl`: the url the item had when the editor loaded, used to detect
//    that a page needs to move. Undefined for items created this session.
export type EditNavItem = {
  label: string
  url: string
  slug: string
  originalUrl?: string
  children?: EditNavItem[]
}

export type Move = { from: string; to: string }

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Last path segment of a root-relative url (`/a/b/c` → `c`, `/` → '').
export function lastSegment(url: string): string {
  const stripped = url.replace(/^\/+|\/+$/g, '')
  if (!stripped) return ''
  return stripped.split('/').pop() ?? ''
}

function joinUrl(parentUrl: string, slug: string): string {
  return `${parentUrl.replace(/\/+$/, '')}/${slug}`
}

// Root-relative pathname of a nav url. Nav items may carry an absolute,
// host-prefixed url (e.g. `https://www.firm.com/who-we-are`) or an already
// root-relative one (`/services`); both map to `/who-we-are` / `/services`.
// Returns null for anything that isn't a resolvable page path (external hosts
// still parse, but callers compare pathnames, so a cross-host move collapses to
// the same path and is skipped). This is why page-move + redirect logic must
// normalize first — a raw `startsWith('/')` check silently drops absolute urls.
export function toPathname(url: string): string | null {
  let pathname: string
  if (/^https?:\/\//i.test(url)) {
    try {
      pathname = new URL(url).pathname
    } catch {
      return null
    }
  } else if (url.startsWith('/')) {
    pathname = url
  } else {
    return null
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

// Seed editor items from a loaded nav: originalUrl = url, slug = last segment.
export function toEditItems(items: NavItem[]): EditNavItem[] {
  return items.map((it) => ({
    label: it.label,
    url: it.url,
    slug: lastSegment(it.url),
    originalUrl: it.url,
    children: it.children ? toEditItems(it.children) : undefined,
  }))
}

// Recompute every descendant's url from its parent's url + its slug. Top-level
// items keep their explicit url (they may be root-relative like `/services`, the
// homepage `/`, or an absolute external link) — only children are derived, which
// is exactly the "nesting drives the URL" behavior.
export function deriveNavUrls(
  items: EditNavItem[],
  parentUrl: string | null = null
): EditNavItem[] {
  return items.map((it) => {
    const url = parentUrl === null ? it.url : joinUrl(parentUrl, it.slug)
    return {
      ...it,
      url,
      children: it.children ? deriveNavUrls(it.children, url) : undefined,
    }
  })
}

// Strip editor-only fields, producing the public nav.json shape.
export function toNavItems(items: EditNavItem[]): NavItem[] {
  return items.map((it) => ({
    label: it.label,
    url: it.url,
    ...(it.children && it.children.length > 0
      ? { children: toNavItems(it.children) }
      : {}),
  }))
}

export function toNavJson(items: EditNavItem[], cta?: NavJson['cta']): NavJson {
  return { primary: toNavItems(items), ...(cta ? { cta } : {}) }
}

// Items whose original url differs from their current (derived) url — each one
// is a page that should move from `from` to `to`. New items (no originalUrl) and
// unchanged items produce nothing. Emits root-relative paths (host stripped) so
// downstream page-move and redirect logic works uniformly whether nav urls are
// absolute or relative; a change that only differs by host produces no move.
export function computeMoves(items: EditNavItem[]): Move[] {
  const moves: Move[] = []
  const walk = (list: EditNavItem[]) => {
    for (const it of list) {
      if (it.originalUrl) {
        const from = toPathname(it.originalUrl)
        const to = toPathname(it.url)
        if (from && to && from !== to) moves.push({ from, to })
      }
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return moves
}
