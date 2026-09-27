import { describe, expect, it } from 'vitest'
import { contactPathFromSitemap, DEFAULT_NAV_CTA_LABEL, withDefaultNavCta } from './nav-cta'
import { gitBlobSha, planDeployPush, SITE_CONFIG_PATHS } from './deploy-plan'

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

describe('default nav.cta reaches a site only on its FIRST deploy', () => {
  it('nav.json is site config: re-deploys skip it, so a CTA removed in the NavEditor stays removed', () => {
    expect(SITE_CONFIG_PATHS.has('content/nav.json')).toBe(true)
    // Operator removed the CTA on draft after the first deploy; a re-package
    // re-adds it to the zip's nav.json, but the push keeps draft's copy.
    const drafted = JSON.stringify({ primary: [] })
    const repackaged = JSON.stringify(withDefaultNavCta({ primary: [] }, []))
    const plan = planDeployPush({
      entries: [{ path: 'content/nav.json', content: repackaged }],
      draftBlobs: new Map([['content/nav.json', gitBlobSha(drafted)]]),
      baseline: { 'content/nav.json': gitBlobSha('{"primary":[],"cta":{"label":"x","url":"/contact"}}') },
    })
    expect(plan.firstDeploy).toBe(false)
    expect(plan.push.some((e) => e.path === 'content/nav.json')).toBe(false)
    expect(plan.skipped).toContainEqual({ path: 'content/nav.json', reason: 'site-config' })
  })
  it('the first deploy does write it', () => {
    const plan = planDeployPush({
      entries: [{ path: 'content/nav.json', content: JSON.stringify(withDefaultNavCta({ primary: [] }, [])) }],
      draftBlobs: new Map(),
      baseline: null,
    })
    expect(plan.firstDeploy).toBe(true)
    expect(plan.push.some((e) => e.path === 'content/nav.json')).toBe(true)
  })
})
