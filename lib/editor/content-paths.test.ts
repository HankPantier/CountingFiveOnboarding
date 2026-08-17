import { describe, expect, it } from 'vitest'
import { contentPathToUrl, stripNavUrl, urlToContentPath } from './content-paths'
import type { NavJson } from '@/types/nav-json'

describe('contentPathToUrl', () => {
  it('maps home.md to the root', () => {
    expect(contentPathToUrl('content/pages/home.md')).toBe('/')
  })

  it('maps a top-level page', () => {
    expect(contentPathToUrl('content/pages/services.md')).toBe('/services')
  })

  it('decodes -- into nested path segments', () => {
    expect(contentPathToUrl('content/pages/services--tax--business.md')).toBe(
      '/services/tax/business'
    )
  })

  it('maps a post to /resources/<slug>', () => {
    expect(contentPathToUrl('content/posts/s-corp-vs-llc.md')).toBe('/resources/s-corp-vs-llc')
  })

  it('handles drafted paths the same as live paths', () => {
    expect(contentPathToUrl('content/drafts/pages/services--tax.md')).toBe('/services/tax')
    expect(contentPathToUrl('content/drafts/posts/foo.md')).toBe('/resources/foo')
  })

  it('returns null for non-content paths', () => {
    expect(contentPathToUrl('content/nav.json')).toBeNull()
    expect(contentPathToUrl('public/content-assets/a.png')).toBeNull()
  })
})

describe('urlToContentPath', () => {
  it('maps a top-level page url', () => {
    expect(urlToContentPath('/services')).toBe('content/pages/services.md')
  })

  it('encodes nested page urls with --', () => {
    expect(urlToContentPath('/services/tax/business')).toBe(
      'content/pages/services--tax--business.md'
    )
  })

  it('maps a /resources/<slug> url to a flat post', () => {
    expect(urlToContentPath('/resources/s-corp-vs-llc')).toBe('content/posts/s-corp-vs-llc.md')
  })

  it('round-trips with contentPathToUrl for pages and posts', () => {
    for (const p of [
      'content/pages/services--tax.md',
      'content/pages/about.md',
      'content/posts/foo.md',
    ]) {
      const url = contentPathToUrl(p)
      expect(url).not.toBeNull()
      expect(urlToContentPath(url as string)).toBe(p)
    }
  })

  it('tolerates a trailing slash', () => {
    expect(urlToContentPath('/services/tax/')).toBe('content/pages/services--tax.md')
  })

  it('preserves uppercase in slugs (real filenames carry it)', () => {
    expect(urlToContentPath('/resources/the-new-KPIs-of-business')).toBe(
      'content/posts/the-new-KPIs-of-business.md'
    )
  })

  it('returns null for the home page', () => {
    expect(urlToContentPath('/')).toBeNull()
  })

  it('returns null for the resources index and deep resource urls', () => {
    expect(urlToContentPath('/resources')).toBeNull()
    expect(urlToContentPath('/resources/a/b')).toBeNull()
  })

  it('returns null for external, relative, or traversal urls', () => {
    expect(urlToContentPath('https://example.com/x')).toBeNull()
    expect(urlToContentPath('services/tax')).toBeNull()
    expect(urlToContentPath('/a/../b')).toBeNull()
    expect(urlToContentPath('/already--nested')).toBeNull()
  })
})

describe('stripNavUrl', () => {
  const nav: NavJson = {
    primary: [
      { label: 'Home', url: '/' },
      {
        label: 'Services',
        url: '/services',
        children: [
          { label: 'Tax', url: '/services/tax' },
          { label: 'Audit', url: '/services/audit' },
        ],
      },
    ],
    cta: { label: 'Contact', url: '/contact' },
  }

  it('removes a matching top-level item', () => {
    const { nav: next, changed } = stripNavUrl(nav, '/services')
    expect(changed).toBe(true)
    expect(next.primary.map((i) => i.url)).toEqual(['/'])
    expect(next.cta).toEqual({ label: 'Contact', url: '/contact' })
  })

  it('removes a matching nested child but keeps the parent', () => {
    const { nav: next, changed } = stripNavUrl(nav, '/services/tax')
    expect(changed).toBe(true)
    const services = next.primary.find((i) => i.url === '/services')
    expect(services?.children?.map((c) => c.url)).toEqual(['/services/audit'])
  })

  it('matches regardless of trailing slash', () => {
    const { changed } = stripNavUrl(nav, '/services/tax/')
    expect(changed).toBe(true)
  })

  it('is a no-op when nothing matches', () => {
    const { nav: next, changed } = stripNavUrl(nav, '/nonexistent')
    expect(changed).toBe(false)
    expect(next).toEqual(nav)
  })
})
