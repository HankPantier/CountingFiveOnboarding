import { describe, expect, it } from 'vitest'
import {
  computeMoves,
  deriveNavUrls,
  lastSegment,
  slugify,
  toEditItems,
  toNavItems,
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
