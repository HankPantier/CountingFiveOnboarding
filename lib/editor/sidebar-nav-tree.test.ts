import { describe, expect, it } from 'vitest'
import {
  buildMergedPagesModel,
  deriveNavLabel,
  navUrlToPagePath,
  pagePathToUrl,
} from './sidebar-nav-tree'
import type { PageFile } from './page-paths'
import type { NavItem } from '@/types/nav-json'

const file = (path: string): PageFile => ({ path, sha: path })

describe('navUrlToPagePath', () => {
  it('maps root-relative urls to page paths', () => {
    expect(navUrlToPagePath('/services')).toBe('content/pages/services.md')
    expect(navUrlToPagePath('/services/tax')).toBe('content/pages/services--tax.md')
    expect(navUrlToPagePath('/services/tax/business')).toBe(
      'content/pages/services--tax--business.md'
    )
  })
  it('special-cases home', () => {
    expect(navUrlToPagePath('/')).toBe('content/pages/home.md')
  })
  it('normalizes absolute, host-prefixed urls', () => {
    expect(navUrlToPagePath('https://www.firm.com/who-we-are')).toBe(
      'content/pages/who-we-are.md'
    )
  })
  it('strips a trailing slash', () => {
    expect(navUrlToPagePath('/services/')).toBe('content/pages/services.md')
  })
  it('returns null for non-resolvable urls', () => {
    expect(navUrlToPagePath('mailto:hi@firm.com')).toBeNull()
    expect(navUrlToPagePath('tel:555')).toBeNull()
  })
})

describe('pagePathToUrl', () => {
  it('inverts navUrlToPagePath', () => {
    expect(pagePathToUrl('content/pages/services.md')).toBe('/services')
    expect(pagePathToUrl('content/pages/services--tax.md')).toBe('/services/tax')
  })
  it('maps home.md to /', () => {
    expect(pagePathToUrl('content/pages/home.md')).toBe('/')
  })
})

describe('deriveNavLabel', () => {
  it('title-cases the last segment', () => {
    expect(deriveNavLabel('content/pages/services--tax-planning.md')).toBe('Tax Planning')
    expect(deriveNavLabel('content/pages/about.md')).toBe('About')
  })
  it('labels home', () => {
    expect(deriveNavLabel('content/pages/home.md')).toBe('Home')
  })
})

describe('buildMergedPagesModel', () => {
  const pages: PageFile[] = [
    file('content/pages/home.md'),
    file('content/pages/services.md'),
    file('content/pages/services--tax.md'),
    file('content/pages/about.md'),
    file('content/pages/landing-promo.md'),
  ]

  it('partitions in-nav (referenced) from not-in-nav, sorted', () => {
    const nav: NavItem[] = [
      { label: 'Home', url: '/' },
      { label: 'Services', url: '/services', children: [{ label: 'Tax', url: '/services/tax' }] },
    ]
    const { navPrimary, notInNav } = buildMergedPagesModel(pages, nav)
    expect(navPrimary).toBe(nav)
    // about + landing-promo are not referenced anywhere in nav
    expect(notInNav.map((f) => f.path)).toEqual([
      'content/pages/about.md',
      'content/pages/landing-promo.md',
    ])
  })

  it('a nested child page is counted as in-nav (not double-listed)', () => {
    const nav: NavItem[] = [
      { label: 'Services', url: '/services', children: [{ label: 'Tax', url: '/services/tax' }] },
    ]
    const { notInNav } = buildMergedPagesModel(pages, nav)
    expect(notInNav.map((f) => f.path)).not.toContain('content/pages/services--tax.md')
  })

  it('external / dangling nav items pull no real page out of notInNav', () => {
    const nav: NavItem[] = [
      { label: 'Facebook', url: 'https://facebook.com/firm' }, // resolves to /firm — no such file
      { label: 'Ghost', url: '/does-not-exist' },
    ]
    const { notInNav } = buildMergedPagesModel(pages, nav)
    // every page remains not-in-nav; no crash, no false match
    expect(notInNav.map((f) => f.path)).toEqual([
      'content/pages/about.md',
      'content/pages/home.md',
      'content/pages/landing-promo.md',
      'content/pages/services.md',
      'content/pages/services--tax.md',
    ])
  })

  it('empty nav → all pages not-in-nav, alphabetical', () => {
    const { notInNav } = buildMergedPagesModel(pages, [])
    expect(notInNav.map((f) => f.path)).toEqual([
      'content/pages/about.md',
      'content/pages/home.md',
      'content/pages/landing-promo.md',
      'content/pages/services.md',
      'content/pages/services--tax.md',
    ])
  })
})
