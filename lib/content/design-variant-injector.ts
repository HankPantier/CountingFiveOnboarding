/**
 * Auto-apply the "Ink & Clay" design language to generated deliverable pages so
 * new client sites ship in-language — a statement hero on the home page and
 * industry-cards rendered as the deep "ink" index band — instead of the flat
 * default. Mirrors the site template's design floor (see
 * docs/design/2026-08-05-ink-and-clay-design-system.md in the template repo).
 *
 * Applied deterministically in the package assembler rather than left to the
 * LLM, so every deliverable is consistent.
 */

/**
 * Append `| theme: ink` to industry-cards annotations so the section renders on
 * the deep primary band (the light → ink → light rhythm). Idempotent — skips
 * any annotation that already declares a theme.
 */
export function applyInkBands(markdown: string): string {
  return markdown.replace(/<!-- block: industry-cards\b[^\n]*?-->/g, (annotation) =>
    /\btheme:\s*/.test(annotation)
      ? annotation
      : annotation.replace(/\s*-->\s*$/, ' | theme: ink -->'),
  )
}

/**
 * Small-caps hero eyebrow from the firm's place + founding year, e.g.
 * "Port Arthur, TX · Since 1950". Returns undefined when there's nothing to show.
 */
export function deriveHeroEyebrow(opts: {
  city?: string | null
  state?: string | null
  foundingYear?: string | null
}): string | undefined {
  const place = [opts.city, opts.state]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .join(', ')
  const since = opts.foundingYear?.trim() ? `Since ${opts.foundingYear.trim()}` : ''
  const parts = [place, since].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

/** True for the site root page: '/' or an origin-only URL (host, optional
 * trailing slash). Empty/null is not treated as home — a real page_url is
 * always '/' for the root. */
export function isHomePage(pageUrl: string | null | undefined): boolean {
  const p = (pageUrl ?? '').trim()
  return p === '/' || /^https?:\/\/[^/]+\/?$/.test(p)
}
