import { describe, expect, it } from 'vitest'
import { normalizeSlug } from './_slug'

describe('normalizeSlug', () => {
  it('maps a single segment to a page path and url', () => {
    expect(normalizeSlug('virtual-cfo-services')).toEqual({
      url: '/virtual-cfo-services',
      path: 'content/pages/virtual-cfo-services.md',
    })
  })

  it('encodes nested slugs with the -- filename convention', () => {
    expect(normalizeSlug('services/tax')).toEqual({
      url: '/services/tax',
      path: 'content/pages/services--tax.md',
    })
  })

  it('lowercases, trims, and collapses noise into hyphens', () => {
    expect(normalizeSlug('  Virtual CFO  Services!! ')).toEqual({
      url: '/virtual-cfo-services',
      path: 'content/pages/virtual-cfo-services.md',
    })
  })

  it('strips leading/trailing slashes', () => {
    expect(normalizeSlug('/about/')).toEqual({
      url: '/about',
      path: 'content/pages/about.md',
    })
  })

  it('rejects the reserved home slug', () => {
    expect(normalizeSlug('home')).toBeNull()
    expect(normalizeSlug('/home/')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(normalizeSlug('')).toBeNull()
    expect(normalizeSlug('   ')).toBeNull()
    expect(normalizeSlug('///')).toBeNull()
  })

  it('neutralizes traversal attempts to a safe in-tree path', () => {
    // '..' segments lose their dots to the [a-z0-9-] filter, so the result can
    // never escape content/pages/ — and it always stays under that root.
    const out = normalizeSlug('../../etc/passwd')
    expect(out).not.toBeNull()
    expect(out!.path.startsWith('content/pages/')).toBe(true)
    expect(out!.path).not.toContain('..')
  })

  it('drops empty nested segments rather than producing a bad path', () => {
    expect(normalizeSlug('services//tax')).toEqual({
      url: '/services/tax',
      path: 'content/pages/services--tax.md',
    })
  })
})
