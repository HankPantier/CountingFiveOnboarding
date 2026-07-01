// ---------------------------------------------------------------------------
// URL → site path normalization, shared by the redirect map + link validators.
//
// Sitemap data is stored in mixed forms: kept pages as absolute URLs
// (https://www.example.com/contact), new pages as paths (/our-team), and Phase I
// destinations sometimes carry prose ("/contact (merge into contact page)").
// Comparing these without stripping the origin makes /contact and
// https://host/contact look like different pages — the source of ~100
// false-positive "not in the confirmed sitemap" warnings. Collapse everything
// to a leading-slash path with no trailing slash so equivalent URLs compare
// equal.
// ---------------------------------------------------------------------------

export function toSitePath(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  // Take the first whitespace-delimited token to drop trailing prose.
  const first = raw.trim().split(/\s+/)[0] ?? ''
  if (!first) return undefined

  let path: string
  if (/^https?:\/\//i.test(first)) {
    try {
      path = new URL(first).pathname
    } catch {
      return undefined
    }
  } else if (first.startsWith('/')) {
    path = first
  } else {
    // Not a path or absolute URL (mailto:, tel:, bare word) — not a site page.
    return undefined
  }

  const noTrailing = path.replace(/\/+$/, '')
  return noTrailing === '' ? '/' : noTrailing
}
