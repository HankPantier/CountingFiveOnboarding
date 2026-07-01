import type { NavJson, NavItem } from '@/types/nav-json'
import { internalizeHref } from '@/lib/content/deliverable-builder'

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
 * Validate that an unknown value has the shape of a NavJson.
 * Checks:
 * - Has a top-level `primary: NavItem[]`
 * - Each NavItem has `label: string` and `url: string`
 * - Children (if present) are also valid NavItems (recursive)
 * - Optional `cta` with `label: string` and `url: string`
 *
 * Returns the typed value or null if validation fails.
 */
function validateNavJson(value: unknown): NavJson | null {
  if (!value || typeof value !== 'object') return null

  const obj = value as Record<string, unknown>

  // Must have primary array
  if (!Array.isArray(obj.primary)) return null

  // Validate each NavItem in primary
  const isValidNavItem = (item: unknown): item is NavItem => {
    if (!item || typeof item !== 'object') return false
    const navItem = item as Record<string, unknown>
    if (typeof navItem.label !== 'string' || typeof navItem.url !== 'string') return false
    // If children exist, validate them recursively
    if (navItem.children !== undefined) {
      if (!Array.isArray(navItem.children)) return false
      return navItem.children.every(isValidNavItem)
    }
    return true
  }

  if (!obj.primary.every(isValidNavItem)) return null

  // Validate optional cta
  if (obj.cta !== undefined) {
    if (!obj.cta || typeof obj.cta !== 'object') return null
    const cta = obj.cta as Record<string, unknown>
    if (typeof cta.label !== 'string' || typeof cta.url !== 'string') return null
  }

  // Return a deep clone to avoid mutation
  return JSON.parse(JSON.stringify(obj)) as NavJson
}

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

/**
 * Rewrite every clickable nav URL (primary items, nested children, header CTA)
 * that points at the firm's own host into an origin-relative path, so the nav
 * follows the current origin — the Vercel preview before launch, the live
 * domain after — instead of hard-jumping to production. Nav URLs are usually
 * already relative; this is belt-and-suspenders for a crawl-seeded sitemap that
 * carried absolute URLs. `host` is the bare firm host (www stripped) from
 * `siteHost()`. Already-relative / external URLs are left untouched.
 */
export function normalizeNavUrls(nav: NavJson, host: string): NavJson {
  const normItem = (item: NavItem): NavItem => ({
    ...item,
    url: internalizeHref(item.url, host),
    ...(item.children ? { children: item.children.map(normItem) } : {}),
  })
  return {
    ...nav,
    primary: nav.primary.map(normItem),
    ...(nav.cta ? { cta: { ...nav.cta, url: internalizeHref(nav.cta.url, host) } } : {}),
  }
}

export function buildNavJson(
  sitemap: SitemapEntry[],
  curated?: unknown
): NavJson {
  // If curated config is provided and passes validation, use it
  if (curated !== null && curated !== undefined) {
    const validated = validateNavJson(curated)
    if (validated) {
      return validated
    }
    // Validation failed — log warning and fall through to sitemap logic
    console.warn(
      '[nav-json-builder] nav_config failed validation — falling back to sitemap'
    )
  }

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
