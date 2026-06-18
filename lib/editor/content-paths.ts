import type { NavJson, NavItem } from '@/types/nav-json'

// Map a content markdown path to the URL it renders at on the live site, so we
// can find (and strip) a matching nav.json entry when a page is drafted/deleted.
//   content/pages/home.md            -> /
//   content/pages/services--tax.md   -> /services/tax
//   content/posts/foo.md             -> /resources/foo
// Page filenames encode URL depth with `--` (mirrors the template's slug
// convention and FileTree's pageSegments). Returns null for non-content paths.
export function contentPathToUrl(path: string): string | null {
  const pageMatch = /^content\/(?:drafts\/)?pages\/(.+)\.md$/.exec(path)
  if (pageMatch) {
    const name = pageMatch[1]
    if (name === 'home') return '/'
    return '/' + name.replace(/--/g, '/')
  }
  const postMatch = /^content\/(?:drafts\/)?posts\/(.+)\.md$/.exec(path)
  if (postMatch) {
    return '/resources/' + postMatch[1]
  }
  return null
}

// Trailing-slash-insensitive comparison; treats '/' as itself.
function normalizeUrl(url: string): string {
  if (url === '/') return '/'
  return url.replace(/\/+$/, '')
}

// Recursively remove any nav item (top-level or nested child) whose url matches
// the given url. Returns the new nav plus whether anything changed.
export function stripNavUrl(nav: NavJson, url: string): { nav: NavJson; changed: boolean } {
  const target = normalizeUrl(url)
  let changed = false

  function filterItems(items: NavItem[]): NavItem[] {
    const result: NavItem[] = []
    for (const item of items) {
      if (normalizeUrl(item.url) === target) {
        changed = true
        continue
      }
      const next: NavItem = { label: item.label, url: item.url }
      if (item.children) next.children = filterItems(item.children)
      result.push(next)
    }
    return result
  }

  const primary = filterItems(nav.primary)
  const result: NavJson = { primary }
  if (nav.cta) result.cta = nav.cta
  return { nav: result, changed }
}
