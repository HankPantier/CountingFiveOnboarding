import { describe, expect, it } from 'vitest'
import {
  computeMoves,
  deriveNavUrls,
  lastSegment,
  slugify,
  toEditItems,
  toNavItems,
  toPathname,
  type EditNavItem,
} from './nav-urls'
import type { NavItem } from '@/types/nav-json'

describe('slugify / lastSegment', () => {
  it('slugifies labels', () => {
    expect(slugify('Outsourced Accounting')).toBe('outsourced-accounting')
    expect(slugify('Tax & Payroll!')).toBe('tax-payroll')
  })
  it('extracts the last path segment', () => {
    expect(lastSegment('/what-we-do/payroll')).toBe('payroll')
    expect(lastSegment('/services')).toBe('services')
    expect(lastSegment('/')).toBe('')
  })
})

describe('deriveNavUrls — nesting drives the URL', () => {
  it('derives child + grandchild urls from ancestor slugs; top level keeps its url', () => {
    const items: EditNavItem[] = [
      {
        label: 'Services',
        url: '/services',
        slug: 'services',
        children: [
          {
            label: 'Outsourced Accounting',
            url: '/what-we-do/outsourced-accounting',
            slug: 'outsourced-accounting',
            originalUrl: '/what-we-do/outsourced-accounting',
            children: [
              {
                label: 'Payroll',
                url: '/what-we-do/payroll',
                slug: 'payroll',
                originalUrl: '/what-we-do/payroll',
              },
            ],
          },
        ],
      },
    ]
    const derived = deriveNavUrls(items)
    expect(derived[0].url).toBe('/services')
    expect(derived[0].children![0].url).toBe('/services/outsourced-accounting')
    expect(derived[0].children![0].children![0].url).toBe(
      '/services/outsourced-accounting/payroll'
    )
  })
})

describe('computeMoves', () => {
  it('emits a move per item whose derived url differs from its original', () => {
    const derived = deriveNavUrls([
      {
        label: 'Services',
        url: '/services',
        slug: 'services',
        children: [
          {
            label: 'Outsourced Accounting',
            url: '/x',
            slug: 'outsourced-accounting',
            originalUrl: '/what-we-do/outsourced-accounting',
            children: [
              { label: 'Payroll', url: '/x', slug: 'payroll', originalUrl: '/what-we-do/payroll' },
              { label: 'New Item', url: '/x', slug: 'new-item' }, // no originalUrl → no move
            ],
          },
        ],
      },
    ])
    expect(computeMoves(derived)).toEqual([
      { from: '/what-we-do/outsourced-accounting', to: '/services/outsourced-accounting' },
      { from: '/what-we-do/payroll', to: '/services/outsourced-accounting/payroll' },
    ])
  })

  it('produces no moves when nothing was re-nested', () => {
    const nav: NavItem[] = [
      { label: 'Services', url: '/services', children: [{ label: 'Tax', url: '/services/tax' }] },
    ]
    expect(computeMoves(deriveNavUrls(toEditItems(nav)))).toEqual([])
  })

  it('emits root-relative moves when nav urls are absolute (host-prefixed)', () => {
    // Regression: nesting "Why Choose BBL" under "Who We Are" when both carry
    // absolute urls must still produce a move — previously dropped, so the page
    // never relocated and the nested url 404'd.
    const derived = deriveNavUrls([
      {
        label: 'Who We Are',
        url: 'https://www.bblcpa.com/who-we-are',
        slug: 'who-we-are',
        originalUrl: 'https://www.bblcpa.com/who-we-are',
        children: [
          {
            label: 'Why Choose BBL',
            url: '/x',
            slug: 'why-choose-bbl',
            originalUrl: 'https://www.bblcpa.com/why-bbl',
          },
        ],
      },
    ])
    expect(computeMoves(derived)).toEqual([
      { from: '/why-bbl', to: '/who-we-are/why-choose-bbl' },
    ])
  })

  it('skips a change that only differs by host', () => {
    const derived = deriveNavUrls([
      {
        label: 'Contact',
        url: 'https://www.bblcpa.com/contact',
        slug: 'contact',
        originalUrl: '/contact',
      },
    ])
    expect(computeMoves(derived)).toEqual([])
  })
})

describe('toPathname', () => {
  it('strips the host from absolute urls', () => {
    expect(toPathname('https://www.bblcpa.com/who-we-are/why-choose-bbl')).toBe(
      '/who-we-are/why-choose-bbl'
    )
  })
  it('passes through root-relative urls, trimming a trailing slash', () => {
    expect(toPathname('/services/tax/')).toBe('/services/tax')
    expect(toPathname('/')).toBe('/')
  })
  it('returns null for non-path values', () => {
    expect(toPathname('mailto:hi@x.com')).toBeNull()
    expect(toPathname('tel:+1')).toBeNull()
  })
})

describe('toNavItems — strips editor-only fields', () => {
  it('emits only label/url/children', () => {
    const derived = deriveNavUrls(
      toEditItems([
        { label: 'Services', url: '/services', children: [{ label: 'Tax', url: '/services/tax' }] },
      ])
    )
    expect(toNavItems(derived)).toEqual([
      { label: 'Services', url: '/services', children: [{ label: 'Tax', url: '/services/tax' }] },
    ])
  })
})
