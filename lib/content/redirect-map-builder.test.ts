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
})
