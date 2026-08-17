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

// Inverse of contentPathToUrl: map a root-relative URL to the LIVE content
// markdown path it renders from. Drafts are off-site and untargetable here.
//   /resources/foo -> content/posts/foo.md   (blog posts are flat)
//   /services/tax  -> content/pages/services--tax.md
//   /services      -> content/pages/services.md
// Returns null for the home page ('/'), external / non-root-relative urls, a
// nested /resources/* (posts don't nest), and any segment containing '.', '..',
// or '--' (which would corrupt the filename encoding or escape the root).
export function urlToContentPath(url: string): string | null {
  if (typeof url !== 'string' || !url.startsWith('/')) return null
  const slug = url.replace(/^\/+|\/+$/g, '')
  if (!slug) return null // home page — not a movable content file
  const segments = slug.split('/')
  // Every segment must be a clean slug ([A-Za-z0-9-]) and free of the '--'
  // separator. Uppercase is allowed because real page filenames carry it (e.g.
  // "the-new-KPIs-of-business"); this must stay a faithful inverse of
  // contentPathToUrl, which preserves case. Rejecting everything else also blocks
  // '.', '..', and percent-encoded traversal ('%2F', '%2e'), so the derived
  // filename can never escape the content root.
  if (segments.some((s) => !/^[A-Za-z0-9-]+$/.test(s) || s.includes('--'))) {
    return null
  }
  if (segments[0] === 'resources') {
    // Posts live flat under content/posts/; only /resources/<one-slug> resolves.
    if (segments.length !== 2) return null
    return `content/posts/${segments[1]}.md`
  }
  return `content/pages/${segments.join('--')}.md`
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
