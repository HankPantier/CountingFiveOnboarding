import { describe, expect, it } from 'vitest'
import {
  collectExpandablePaths,
  computeMoves,
  deriveNavUrls,
  lastSegment,
  orderMoves,
  reparentItems,
  slugify,
  toEditItems,
  toNavItems,
  toPathname,
  validReparentTargets,
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

describe('reparentItems — nest an item under a chosen sibling', () => {
  const services = (): EditNavItem[] => [
    {
      label: 'Services',
      url: '/services',
      slug: 'services',
      children: [
        { label: 'Outsourced', url: '/services/outsourced', slug: 'outsourced', originalUrl: '/services/outsourced' },
        { label: 'Accounting', url: '/services/accounting', slug: 'accounting', originalUrl: '/services/accounting' },
      ],
    },
  ]

  it('moves a secondary to become a tertiary child, preserving originalUrl', () => {
    // Nest Accounting (services.children[1]) under Outsourced (services.children[0]).
    const out = reparentItems(services(), [0, 1], [0, 0], 2)
    const outsourced = out[0].children![0]
    expect(out[0].children).toHaveLength(1)
    expect(outsourced.children).toHaveLength(1)
    const moved = outsourced.children![0]
    expect(moved.label).toBe('Accounting')
    expect(moved.originalUrl).toBe('/services/accounting')

    const derived = deriveNavUrls(out)
    expect(derived[0].children![0].children![0].url).toBe('/services/outsourced/accounting')
    expect(computeMoves(derived)).toEqual([
      { from: '/services/accounting', to: '/services/outsourced/accounting' },
    ])
  })

  it('rejects nesting an item under itself or a descendant', () => {
    const tree: EditNavItem[] = [
      { label: 'A', url: '/a', slug: 'a', children: [{ label: 'B', url: '/a/b', slug: 'b' }] },
    ]
    expect(reparentItems(tree, [0], [0], 2)).toEqual(tree) // self
    expect(reparentItems(tree, [0], [0, 0], 2)).toEqual(tree) // descendant
  })

  it('rejects a move that would exceed maxDepth', () => {
    // Parent with a tertiary child (height 1) cannot nest under another secondary
    // (parent length 2) → would create depth 3.
    const tree: EditNavItem[] = [
      {
        label: 'Services',
        url: '/services',
        slug: 'services',
        children: [
          { label: 'A', url: '/services/a', slug: 'a', children: [{ label: 'A1', url: '/services/a/a1', slug: 'a1' }] },
          { label: 'B', url: '/services/b', slug: 'b' },
        ],
      },
    ]
    expect(reparentItems(tree, [0, 0], [0, 1], 2)).toEqual(tree)
  })

  it('deletes an emptied children array on the source parent', () => {
    const tree: EditNavItem[] = [
      { label: 'A', url: '/a', slug: 'a', children: [{ label: 'A1', url: '/a/a1', slug: 'a1' }] },
      { label: 'B', url: '/b', slug: 'b' },
    ]
    const out = reparentItems(tree, [0, 0], [1], 2) // move A1 under B
    expect(out[0].children).toBeUndefined()
    expect(out[1].children).toHaveLength(1)
  })

  it('lands correctly when moving an earlier sibling under a later one', () => {
    const tree: EditNavItem[] = [
      { label: 'A', url: '/a', slug: 'a' },
      { label: 'B', url: '/b', slug: 'b' },
      { label: 'C', url: '/c', slug: 'c' },
    ]
    const out = reparentItems(tree, [0], [2], 2) // move A under C
    expect(out.map((n) => n.label)).toEqual(['B', 'C'])
    expect(out[1].children!.map((n) => n.label)).toEqual(['A'])
  })
})

describe('validReparentTargets', () => {
  const tree: EditNavItem[] = [
    {
      label: 'Services',
      url: '/services',
      slug: 'services',
      children: [
        { label: 'Outsourced', url: '/services/outsourced', slug: 'outsourced' },
        { label: 'Accounting', url: '/services/accounting', slug: 'accounting' },
      ],
    },
    { label: 'About', url: '/about', slug: 'about' },
  ]

  it('excludes self, descendants, and current parent; includes valid siblings/parents', () => {
    // Target for Accounting ([0,1]): its sibling Outsourced ([0,0]) and About ([1]).
    // Excludes Services ([0], current parent) and itself.
    const targets = validReparentTargets(tree, [0, 1], 2).map((t) => t.path.join('/'))
    expect(targets).toContain('0/0')
    expect(targets).toContain('1')
    expect(targets).not.toContain('0') // current parent
    expect(targets).not.toContain('0/1') // self
  })

  it('drops targets that would exceed maxDepth for the moving subtree', () => {
    const withChild: EditNavItem[] = [
      {
        label: 'Services',
        url: '/services',
        slug: 'services',
        children: [
          { label: 'A', url: '/services/a', slug: 'a', children: [{ label: 'A1', url: '/services/a/a1', slug: 'a1' }] },
          { label: 'B', url: '/services/b', slug: 'b' },
        ],
      },
    ]
    // Moving A (height 1) can't nest under B ([0,1], length 2 → depth 3).
    const targets = validReparentTargets(withChild, [0, 0], 2).map((t) => t.path.join('/'))
    expect(targets).not.toContain('0/1')
  })
})

describe('orderMoves — vacated slots freed before reuse', () => {
  it('orders a chain so the target-vacating move runs first', () => {
    const ordered = orderMoves([
      { from: '/a', to: '/b' },
      { from: '/b', to: '/c' },
    ])
    expect(ordered).toEqual([
      { from: '/b', to: '/c' },
      { from: '/a', to: '/b' },
    ])
  })

  it('preserves order for independent moves', () => {
    const moves = [
      { from: '/one', to: '/x/one' },
      { from: '/two', to: '/x/two' },
    ]
    expect(orderMoves(moves)).toEqual(moves)
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

describe('collectExpandablePaths', () => {
  const tree: EditNavItem[] = [
    {
      label: 'Services',
      url: '/services',
      slug: 'services',
      children: [
        {
          label: 'Accounting',
          url: '/services/accounting',
          slug: 'accounting',
          children: [
            { label: 'Payroll', url: '/services/accounting/payroll', slug: 'payroll' },
          ],
        },
        { label: 'Tax', url: '/services/tax', slug: 'tax' },
      ],
    },
    { label: 'About', url: '/about', slug: 'about' },
  ]

  it('returns pathIds of every node that has children, depth-first', () => {
    expect(collectExpandablePaths(tree)).toEqual(['0', '0/0'])
  })

  it('returns an empty list for a flat menu with no sub-items', () => {
    const flat: EditNavItem[] = [
      { label: 'Home', url: '/', slug: '' },
      { label: 'About', url: '/about', slug: 'about' },
    ]
    expect(collectExpandablePaths(flat)).toEqual([])
  })
})
