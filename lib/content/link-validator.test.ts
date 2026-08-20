import { describe, expect, it } from 'vitest'
import { validateInternalLinks, filterKnownInternalLinks } from './link-validator'

const SITEMAP = ['/services', '/services/tax', '/about', '/contact']

function page(partial: Partial<{ page_url: string; content_markdown: string; internal_links: unknown }>) {
  return {
    page_url: '/services',
    content_markdown: '',
    internal_links: [],
    ...partial,
  }
}

describe('validateInternalLinks', () => {
  it('flags metadata links pointing outside the sitemap', () => {
    const warnings = validateInternalLinks(
      [page({ internal_links: [{ url: '/services/old-offering', anchor_text: 'x', reason: 'y' }] })],
      SITEMAP
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('/services/old-offering')
  })

  it('flags relative body links to unknown pages, ignores external/anchors/assets', () => {
    const md = [
      '[bad](/services/bogus)',
      '[good](/about)',
      '[ext](https://example.com/x)',
      '[anchor](#section)',
      '[asset](/files/brochure.pdf)',
      '[home](/)',
    ].join('\n')
    const warnings = validateInternalLinks([page({ content_markdown: md })], SITEMAP)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('/services/bogus')
  })

  it('skips blog-post paths (drafted outside the sitemap) and normalizes trailing slashes', () => {
    const md = '[post](/resources/tax-tips-2026)\n[ok](/services/tax/)'
    expect(validateInternalLinks([page({ content_markdown: md })], SITEMAP)).toHaveLength(0)
  })

  it('dedups repeated warnings for the same page→target pair', () => {
    const md = '[a](/nope)\n[b](/nope)'
    expect(validateInternalLinks([page({ content_markdown: md })], SITEMAP)).toHaveLength(1)
  })

  it('matches path links against absolute-URL sitemap entries (origin stripped)', () => {
    // Sitemap stores kept pages as absolute URLs; page links use paths. These
    // are the same page and must not warn.
    const sitemap = ['https://www.acme.com/contact', 'https://www.acme.com/services']
    const md = '[c](/contact)\n[s](/services)'
    expect(validateInternalLinks([page({ content_markdown: md })], sitemap)).toHaveLength(0)
  })
})

describe('filterKnownInternalLinks', () => {
  const links = (...urls: unknown[]) => urls.map(url => ({ url, anchor_text: 'a', reason: 'r' }))

  it('keeps real sitemap links and drops hallucinated/typo paths', () => {
    const out = filterKnownInternalLinks(
      links('/about', '/services/tax', '/services/made-up'),
      SITEMAP
    )
    expect(out.map(l => l.url)).toEqual(['/about', '/services/tax'])
  })

  it('keeps home and blog-post/asset targets (not sitemap-constrained)', () => {
    const out = filterKnownInternalLinks(
      links('/', '/resources/tax-tips-2026', '/files/brochure.pdf'),
      SITEMAP
    )
    expect(out.map(l => l.url)).toEqual(['/', '/resources/tax-tips-2026', '/files/brochure.pdf'])
  })

  it('drops malformed or non-root-relative entries', () => {
    const out = filterKnownInternalLinks(
      links('https://example.com/x', '#anchor', 'mailto:a@b.com', 42, null),
      SITEMAP
    )
    expect(out).toHaveLength(0)
  })

  it('matches paths against absolute-URL sitemap entries', () => {
    const out = filterKnownInternalLinks(links('/contact'), ['https://www.acme.com/contact'])
    expect(out.map(l => l.url)).toEqual(['/contact'])
  })
})
