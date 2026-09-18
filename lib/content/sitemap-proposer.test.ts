import { describe, expect, it } from 'vitest'
import { buildSkeletonProposal, ensureBlockParents } from './sitemap-proposer'
import type { SessionSchema } from '@/types/session-schema'
import type { AuditResult } from '@/types/audit-result'

const schema = (over: Partial<SessionSchema> = {}): SessionSchema => ({ ...over }) as SessionSchema

describe('buildSkeletonProposal', () => {
  it('keeps live pages as updates and adds templated niche/service hubs + children', () => {
    const out = buildSkeletonProposal(
      schema({
        current_sitemap: [
          { url: 'https://acme.example/', title: 'Home', action: 'keep', live: true },
          { url: 'https://acme.example/about', title: 'About', action: 'keep', live: true },
          { url: 'https://acme.example/gone', title: 'Gone', action: 'redirect', live: false },
        ],
        niches: [
          { name: 'Construction', description: 'Contractors.', icp: '', painPoints: '', valueProp: 'Job costing.' },
          { name: 'Restaurants', description: '', icp: '', painPoints: '', valueProp: '' },
        ],
        services: [
          { name: 'Tax Planning', description: 'Year-round strategy.', offerings: [] },
        ],
      })
    )

    const byUrl = Object.fromEntries(out.map(p => [p.url, p]))

    // existing live pages → updates (redirect/non-live excluded), URLs
    // normalized to clean root-relative paths before the AI enrichment pass
    expect(byUrl['/'].status).toBe('update')
    expect(byUrl['/about'].status).toBe('update')
    expect(byUrl['https://acme.example/about']).toBeUndefined()
    expect(byUrl['/gone']).toBeUndefined()

    // niche hub + children with parent links
    expect(byUrl['/industries'].status).toBe('new')
    expect(byUrl['/industries/construction']).toMatchObject({ status: 'new', parent: '/industries', notes: 'Job costing.' })
    expect(byUrl['/industries/restaurants']).toMatchObject({ status: 'new', parent: '/industries' })

    // service hub + child
    expect(byUrl['/services'].status).toBe('new')
    expect(byUrl['/services/tax-planning']).toMatchObject({ status: 'new', parent: '/services', notes: 'Year-round strategy.' })
  })

  it('falls back to audit crawl pages when no current_sitemap', () => {
    const audit = {
      page_analysis_summary: [
        { url: 'https://x.example/', status_code: 200, title: 'Home' },
        { url: 'https://x.example/404', status_code: 404, title: 'Missing' },
      ],
    } as unknown as AuditResult

    const out = buildSkeletonProposal(schema({}), audit)
    // Crawl URLs normalized to root-relative paths (build-safe, not mangled).
    expect(out.map(p => p.url)).toContain('/')
    expect(out.map(p => p.url)).not.toContain('https://x.example/')
    expect(out.map(p => p.url)).not.toContain('https://x.example/404')
    expect(out.every(p => p.status === 'update')).toBe(true)
  })

  it('adds location hubs + service×geo pages when serviceAreas are present', () => {
    const out = buildSkeletonProposal(
      schema({
        services: [
          { name: 'Tax Planning', description: '', offerings: [] },
          { name: 'Bookkeeping', description: '', offerings: [] },
        ],
        business: {
          serviceAreas: [
            { city: 'Nashua', state: 'NH', primary: true },
            { city: 'Manchester', state: 'NH' },
          ],
        },
      } as unknown as Partial<SessionSchema>)
    )
    const byUrl = Object.fromEntries(out.map(p => [p.url, p]))

    // locations hub + per-city hubs
    expect(byUrl['/locations']).toMatchObject({ status: 'new', parent: '/' })
    expect(byUrl['/locations/nashua']).toMatchObject({
      status: 'new',
      parent: '/locations',
      title: 'Nashua CPA',
    })
    expect(byUrl['/locations/manchester']).toMatchObject({ status: 'new', parent: '/locations' })

    // service×geo pages nested under their service page, with "<Service> in <City>, <State>"
    expect(byUrl['/services/tax-planning-nashua']).toMatchObject({
      status: 'new',
      parent: '/services/tax-planning',
      title: 'Tax Planning in Nashua, NH',
    })
    expect(byUrl['/services/bookkeeping-manchester']).toMatchObject({
      status: 'new',
      parent: '/services/bookkeeping',
      title: 'Bookkeeping in Manchester, NH',
    })
  })

  it('adds no local pages when serviceAreas is empty', () => {
    const out = buildSkeletonProposal(
      schema({
        services: [{ name: 'Tax Planning', description: '', offerings: [] }],
      })
    )
    expect(out.some(p => p.url.startsWith('/locations'))).toBe(false)
    expect(out.some(p => /^\/services\/.+-.+/.test(p.url) && p.parent?.startsWith('/services/'))).toBe(false)
  })

  it('skips a service-area city that already has a physical location page', () => {
    const out = buildSkeletonProposal(
      schema({
        locations: [{ city: 'Nashua', state: 'NH' } as never],
        services: [{ name: 'Tax Planning', description: '', offerings: [] }],
        business: {
          serviceAreas: [
            { city: 'Nashua', state: 'NH', primary: true },
            { city: 'Manchester', state: 'NH' },
          ],
        },
      } as unknown as Partial<SessionSchema>)
    )
    const urls = out.map(p => p.url)
    // Nashua has a real office → no duplicate hub and no service×geo for it
    expect(urls).not.toContain('/locations/nashua')
    expect(urls).not.toContain('/services/tax-planning-nashua')
    // Manchester (service-area only) still gets a hub + service×geo
    expect(urls).toContain('/locations/manchester')
    expect(urls).toContain('/services/tax-planning-manchester')
  })

  it('caps hubs and service×geo pages, preferring primary areas', () => {
    const areas = Array.from({ length: 10 }, (_, i) => ({
      city: `City${i}`,
      state: 'NH',
      primary: i >= 8, // the last two are primary
    }))
    const services = Array.from({ length: 6 }, (_, i) => ({
      name: `Service ${i}`,
      description: '',
      offerings: [],
    }))
    const out = buildSkeletonProposal(
      schema({ services, business: { serviceAreas: areas } } as unknown as Partial<SessionSchema>)
    )
    const hubs = out.filter(p => p.parent === '/locations')
    // LOCAL_HUB_CAP = 6
    expect(hubs).toHaveLength(6)
    // primary cities win the ordering → both appear among the hubs
    const hubUrls = hubs.map(p => p.url)
    expect(hubUrls).toContain('/locations/city8')
    expect(hubUrls).toContain('/locations/city9')

    // service×geo: top 3 services × up to 4 primary-first areas (that have a hub) = 12
    const geo = out.filter(p => p.parent?.startsWith('/services/') && p.parent !== '/services')
    expect(geo).toHaveLength(12)
    // only the 3 capped services appear
    const geoServiceParents = new Set(geo.map(p => p.parent))
    expect(geoServiceParents.size).toBe(3)
    // every service×geo targets a city that has a hub
    const hubCitySlugs = new Set(hubUrls.map(u => u.replace('/locations/', '')))
    for (const p of geo) {
      const citySlug = p.url.split('-').pop()!
      expect(hubCitySlugs.has(citySlug)).toBe(true)
    }
  })

  it('dedupes by normalized url', () => {
    const out = buildSkeletonProposal(
      schema({
        current_sitemap: [
          { url: 'https://acme.example/team/', title: 'Team', action: 'keep', live: true },
          { url: 'https://acme.example/team', title: 'Team dup', action: 'keep', live: true },
        ],
      })
    )
    expect(out.filter(p => p.url.toLowerCase().replace(/\/+$/, '').endsWith('/team')).length).toBe(1)
  })

  it('omits own-page URLs for content-block services/niches and promotes page sub-services', () => {
    const out = buildSkeletonProposal(
      schema({
        services: [
          { name: 'Tax Prep', description: '', offerings: [] },
          { name: 'Audit Protection', description: '', offerings: [], pageTreatment: 'block' },
        ],
        niches: [
          {
            name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '',
            subCategories: [
              { name: 'Implants', status: 'confirmed', pageTreatment: 'page' },
              { name: 'Cleanings', status: 'confirmed' },
            ],
          },
          { name: 'Legal', description: '', icp: '', painPoints: '', valueProp: '', pageTreatment: 'block' },
        ],
      } as unknown as Partial<SessionSchema>)
    )
    const urls = out.map(p => p.url)
    // block service + block niche get NO own page
    expect(urls).not.toContain('/services/audit-protection')
    expect(urls).not.toContain('/industries/legal')
    // page service + page niche still do
    expect(urls).toContain('/services/tax-prep')
    expect(urls).toContain('/industries/dental')
    // promoted sub-service gets its own nested page; block sub does not
    expect(urls).toContain('/industries/dental/implants')
    expect(urls).not.toContain('/industries/dental/cleanings')
  })

  it('still creates the category hub when EVERY item is a content block', () => {
    const out = buildSkeletonProposal(
      schema({
        services: [{ name: 'Audit Protection', description: '', offerings: [], pageTreatment: 'block' }],
        niches: [{ name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '', pageTreatment: 'block' }],
      } as unknown as Partial<SessionSchema>)
    )
    const urls = out.map(p => p.url)
    // hubs exist so the block sections have a page to render on...
    expect(urls).toContain('/services')
    expect(urls).toContain('/industries')
    // ...but the block items themselves still get no own page
    expect(urls).not.toContain('/services/audit-protection')
    expect(urls).not.toContain('/industries/dental')
  })
})

describe('ensureBlockParents', () => {
  const blockSchema = {
    services: [{ name: 'Audit Protection', description: '', offerings: [], pageTreatment: 'block' }],
    niches: [{ name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '', pageTreatment: 'block' }],
  } as unknown as SessionSchema
  const skeleton = buildSkeletonProposal(blockSchema)

  it('re-adds a block-parent hub that AI enrichment dropped', () => {
    // Enrichment returned a sitemap WITHOUT the childless hubs.
    const enriched = [{ url: '/', title: 'Home', status: 'update' as const }]
    const out = ensureBlockParents(blockSchema, enriched, skeleton).map(p => p.url)
    expect(out).toContain('/services')
    expect(out).toContain('/industries')
  })

  it('leaves the sitemap untouched when the hubs survived enrichment', () => {
    const enriched = [
      { url: '/services', title: 'Services', status: 'new' as const, parent: '/' },
      { url: '/industries', title: 'Industries we serve', status: 'new' as const, parent: '/' },
    ]
    expect(ensureBlockParents(blockSchema, enriched, skeleton)).toHaveLength(2)
  })

  it('does nothing when there are no block items', () => {
    const pageSchema = { services: [{ name: 'Tax', description: '', offerings: [] }] } as unknown as SessionSchema
    const enriched = [{ url: '/services/tax', title: 'Tax', status: 'new' as const, parent: '/services' }]
    expect(ensureBlockParents(pageSchema, enriched, buildSkeletonProposal(pageSchema))).toBe(enriched)
  })

  it('keeps required hubs even when enrichment already filled the 60-page cap', () => {
    // A full 60-page enriched sitemap with neither hub present.
    const enriched = Array.from({ length: 60 }, (_, i) => ({
      url: `/page-${i}`, title: `Page ${i}`, status: 'new' as const, parent: '/',
    }))
    const out = ensureBlockParents(blockSchema, enriched, skeleton)
    const urls = out.map(p => p.url)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(urls).toContain('/services') // hubs survived...
    expect(urls).toContain('/industries')
    expect(urls).not.toContain('/page-59') // ...by trimming the enriched tail
    expect(urls).toContain('/page-0') // ...not the head
  })

  it('never trims a required parent enrichment kept near the tail (drops a non-required one instead)', () => {
    // Full 60-page list: /services is a REQUIRED parent sitting at the very tail;
    // /industries is missing. Making room for /industries must not cut /services.
    const enriched = [
      ...Array.from({ length: 59 }, (_, i) => ({ url: `/page-${i}`, title: `Page ${i}`, status: 'new' as const, parent: '/' })),
      { url: '/services', title: 'Services', status: 'new' as const, parent: '/' },
    ]
    const out = ensureBlockParents(blockSchema, enriched, skeleton)
    const urls = out.map(p => p.url)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(urls).toContain('/services') // present required parent at the tail preserved
    expect(urls).toContain('/industries') // missing required parent added
    expect(urls).not.toContain('/page-58') // a NON-required tail page dropped instead
  })
})
