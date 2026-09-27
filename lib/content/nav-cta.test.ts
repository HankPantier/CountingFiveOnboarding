import { describe, expect, it } from 'vitest'
import { contactPathFromSitemap, DEFAULT_NAV_CTA_LABEL, withDefaultNavCta } from './nav-cta'

describe('withDefaultNavCta — header CTA on by default', () => {
  const primary = [{ label: 'Services', url: '/services' }]

  it('adds "Schedule a consultation" → the contact page when nav has no cta', () => {
    expect(withDefaultNavCta({ primary }, [{ url: '/services' }, { url: '/contact-us' }])).toEqual({
      primary,
      cta: { label: DEFAULT_NAV_CTA_LABEL, url: '/contact-us' },
    })
    expect(DEFAULT_NAV_CTA_LABEL).toBe('Schedule a consultation')
  })

  it('keeps an operator-set cta untouched', () => {
    const nav = { primary, cta: { label: 'Book a call', url: '/book' } }
    expect(withDefaultNavCta(nav, [{ url: '/contact' }])).toBe(nav)
  })

  it('replaces a half-blank cta with the default', () => {
    expect(withDefaultNavCta({ primary, cta: { label: ' ', url: '/x' } }, []).cta).toEqual({
      label: DEFAULT_NAV_CTA_LABEL,
      url: '/contact',
    })
  })
})

describe('contactPathFromSitemap', () => {
  it('prefers the shallowest contact page, handles absolute urls, skips redirects', () => {
    expect(
      contactPathFromSitemap([
        { url: '/about/contact' },
        { url: 'https://firm.com/contact/' },
        { url: '/contact-us', status: 'redirect' },
      ]),
    ).toBe('/contact')
    expect(contactPathFromSitemap([{ url: '/who-we-are/contact-us' }])).toBe('/who-we-are/contact-us')
  })

  it('falls back to /contact (the template contact drawer serves it without a page)', () => {
    expect(contactPathFromSitemap([{ url: '/contacts-directory' }, { url: '/services' }])).toBe('/contact')
  })
})
