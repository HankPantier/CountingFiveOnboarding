import { describe, expect, it } from 'vitest'
import { buildRedirectsCsv } from './redirect-map-builder'

const NEW_SITEMAP = [
  { url: '/', title: 'Home' },
  { url: '/contact', title: 'Contact' },
  { url: '/resources', title: 'Resources' },
  { url: '/resources/articles', title: 'Articles' },
]

describe('buildRedirectsCsv — Phase I annotated destinations', () => {
  it('strips prose annotations from new_url ("/contact (merge into contact page)")', () => {
    const { csv, issues } = buildRedirectsCsv(
      [{ url: '/hours', title: 'T', live: true, action: 'redirect', new_url: '/contact (merge into contact page)' }],
      NEW_SITEMAP
    )
    expect(issues).toHaveLength(0)
    expect(csv).toContain('/hours,/contact,301')
  })

  it('normalizes trailing slashes ("/resources/articles/ (bulk)")', () => {
    const { csv, issues } = buildRedirectsCsv(
      [{ url: '/resources/blog/', title: 'T', live: true, action: 'redirect', new_url: '/resources/articles/ (bulk)' }],
      NEW_SITEMAP
    )
    expect(issues).toHaveLength(0)
    expect(csv).toContain('/resources/blog/,/resources/articles,301')
  })

  it('treats keep-with-new_url as a redirect when the old URL is gone', () => {
    const { csv, issues } = buildRedirectsCsv(
      [{ url: '/resources/resource-library', title: 'T', live: true, action: 'keep', new_url: '/resources' }],
      NEW_SITEMAP
    )
    expect(issues).toHaveLength(0)
    expect(csv).toContain('/resources/resource-library,/resources,301,content moved in new structure')
  })

  it('still warns on keep without a usable destination', () => {
    const { issues } = buildRedirectsCsv(
      [{ url: '/old-page', title: 'T', live: true, action: 'keep' }],
      NEW_SITEMAP
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
  })

  it('still errors when the destination genuinely does not exist', () => {
    const { issues, csv } = buildRedirectsCsv(
      [{ url: '/x', title: 'T', live: true, action: 'redirect', new_url: '/definitely-not-real' }],
      NEW_SITEMAP
    )
    expect(issues[0].severity).toBe('error')
    expect(csv).not.toContain('/definitely-not-real')
  })

  it('keeps quiet on keep-URLs that exist in the new sitemap', () => {
    const { issues } = buildRedirectsCsv(
      [{ url: '/contact', title: 'T', live: true, action: 'keep' }],
      NEW_SITEMAP
    )
    expect(issues).toHaveLength(0)
  })

  it('matches absolute old/new URLs against a path sitemap (origin stripped)', () => {
    // Real data stores kept pages as absolute URLs in BOTH the current and the
    // confirmed sitemap. A kept page present in the new sitemap must not warn.
    const { issues } = buildRedirectsCsv(
      [{ url: 'https://www.acme.com/contact', title: 'T', live: true, action: 'keep' }],
      [{ url: 'https://www.acme.com/contact', title: 'Contact', status: 'update' }]
    )
    expect(issues).toHaveLength(0)
  })
})

describe('buildRedirectsCsv — sources are root-relative paths', () => {
  it('writes an absolute old-site url as its path (Next needs a leading /)', () => {
    const { csv } = buildRedirectsCsv(
      [
        { url: 'https://www.acme.com/about-us/', title: 'T', live: true, action: 'redirect', new_url: '/contact' },
        { url: 'https://www.acme.com/hours', title: 'T', live: true, action: 'keep', new_url: '/contact' },
      ],
      NEW_SITEMAP
    )
    expect(csv).toContain('\n/about-us/,/contact,301')
    expect(csv).toContain('\n/hours,/contact,301')
    expect(csv).not.toContain('https://')
  })
})

describe('buildRedirectsCsv — query-string sources', () => {
  it('strips ?query / #hash from a source path', () => {
    const { csv } = buildRedirectsCsv(
      [{ url: '/services/?ref=nav#top', title: 'T', live: true, action: 'redirect', new_url: '/contact' }],
      NEW_SITEMAP
    )
    expect(csv).toContain('\n/services/,/contact,301')
    expect(csv).not.toContain('ref=nav')
    expect(csv).not.toContain('#top')
  })

  it('drops (and reports) a WordPress /?page_id=12 that leaves only the home path', () => {
    const redirect = buildRedirectsCsv(
      [{ url: '/?page_id=12', title: 'T', live: true, action: 'redirect', new_url: '/contact' }],
      NEW_SITEMAP
    )
    expect(redirect.csv).not.toContain(',/contact,301')
    expect(redirect.issues).toEqual([expect.objectContaining({ oldUrl: '/?page_id=12', reason: expect.stringMatching(/query string/) })])

    // keep-with-new_url path, on a sitemap without a home page entry.
    const keep = buildRedirectsCsv(
      [{ url: 'https://www.acme.com/?p=4', title: 'T', live: true, action: 'keep', new_url: '/contact' }],
      [{ url: '/contact', title: 'Contact' }]
    )
    expect(keep.csv).not.toContain(',/contact,301')
    expect(keep.issues).toEqual([expect.objectContaining({ reason: expect.stringMatching(/query string/) })])
  })
})

describe('buildRedirectsCsv — never shadows a real page or loops', () => {
  const SITEMAP = [
    { url: '/services', title: 'Services' },
    { url: '/services/outsourced-accounting', title: 'Outsourced accounting' },
  ]

  it('drops a consolidate row whose old URL is still a page in the new sitemap (Accord)', () => {
    const { csv, issues } = buildRedirectsCsv(
      [{ url: 'https://acc.example/services/outsourced-accounting/', title: 'T', live: true, action: 'consolidate', new_url: '/services' }],
      SITEMAP
    )
    expect(csv).not.toContain('outsourced-accounting/,')
    expect(issues[0].reason).toMatch(/still has a page/)
  })

  it('drops a self-redirect', () => {
    const { csv, issues } = buildRedirectsCsv(
      [{ url: '/services/', title: 'T', live: true, action: 'redirect', new_url: '/services' }],
      SITEMAP
    )
    expect(csv).not.toMatch(/^\/services\/,/m)
    expect(issues[0].reason).toMatch(/itself/)
  })
})
