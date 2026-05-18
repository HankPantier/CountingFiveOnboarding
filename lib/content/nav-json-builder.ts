import type { NavJson, NavItem } from '@/types/nav-json'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SitemapEntry = {
  url: string
  title: string
  parent?: string
  status?: string // 'new' | 'update' | 'existing' | 'redirect' | 'consolidate'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Humanize a URL slug into a label.
 * e.g., '/services/virtual-cfo-advisory' → 'Virtual Cfo Advisory'
 */
function slugToLabel(url: string): string {
  // Remove leading/trailing slashes
  const slug = url.replace(/^\/+|\/+$/g, '')
  // If empty after stripping, return generic fallback
  if (!slug) return 'Home'
  // Take the last segment (rightmost path component)
  const lastSegment = slug.split('/').pop() || slug
  // Replace hyphens with spaces, capitalize each word
  return lastSegment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Determine the effective label for an item.
 * Use the title field if non-empty, otherwise fall back to humanized slug.
 */
function getLabel(entry: SitemapEntry): string {
  if (entry.title && entry.title.trim().length > 0) {
    return entry.title
  }
  return slugToLabel(entry.url)
}

/**
 * Determine if an entry should be included in the nav.
 * Skip entries with status 'redirect' or 'consolidate'.
 */
function shouldInclude(entry: SitemapEntry): boolean {
  const status = entry.status?.toLowerCase() ?? ''
  return status !== 'redirect' && status !== 'consolidate'
}

/**
 * Determine if a URL is the homepage.
 */
function isHomepage(url: string): boolean {
  return url === '/' || url === ''
}

/**
 * Determine if an entry is a root-level nav item.
 * Root items have no parent or parent is the homepage.
 */
function isRootItem(entry: SitemapEntry): boolean {
  const parent = entry.parent ?? ''
  return parent === '' || parent === '/' || isHomepage(parent)
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildNavJson(sitemap: SitemapEntry[]): NavJson {
  // Filter out redirect/consolidate entries
  const included = sitemap.filter(shouldInclude)

  // Build a map: url → entry, for fast parent lookup
  const entriesByUrl = new Map<string, SitemapEntry>()
  for (const entry of included) {
    if (entry.url) {
      entriesByUrl.set(entry.url, entry)
    }
  }

  // Separate root and child items
  const rootItems: SitemapEntry[] = []
  const childItems: SitemapEntry[] = []
  const orphanedChildren = new Set<string>() // Track orphaned URLs for warning

  for (const entry of included) {
    if (isRootItem(entry)) {
      // Skip homepage itself from primary nav
      if (!isHomepage(entry.url)) {
        rootItems.push(entry)
      }
    } else {
      // This is a child item (has a non-root parent)
      const parent = entry.parent!
      if (entriesByUrl.has(parent)) {
        // Parent exists
        childItems.push(entry)
      } else {
        // Parent does not exist → orphaned
        orphanedChildren.add(entry.url)
        // Flatten to root with a warning
        rootItems.push(entry)
        console.warn(
          `[nav-json-builder] Orphaned child: url="${entry.url}" parent="${parent}" does not exist. Flattening to root.`
        )
      }
    }
  }

  // Build the primary nav tree
  const primaryNav: NavItem[] = rootItems.map((root): NavItem => {
    const children = childItems
      .filter((child) => child.parent === root.url)
      .map((child): NavItem => ({
        label: getLabel(child),
        url: child.url,
      }))

    return {
      label: getLabel(root),
      url: root.url,
      ...(children.length > 0 && { children }),
    }
  })

  // Check for deeper nesting (grandchildren)
  // If a child's parent itself has a non-root parent, warn and flatten
  for (const childEntry of childItems) {
    const parentEntry = entriesByUrl.get(childEntry.parent!)
    if (parentEntry && !isRootItem(parentEntry)) {
      console.warn(
        `[nav-json-builder] Deep nesting detected: url="${childEntry.url}" → parent="${childEntry.parent}" → grandparent="${parentEntry.parent}". Flattening to root.`
      )
    }
  }

  return {
    primary: primaryNav,
    // v1: cta is undefined (no header CTA button by default)
  }
}
