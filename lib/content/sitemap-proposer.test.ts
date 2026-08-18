import { describe, expect, it } from 'vitest'
import { buildSkeletonProposal } from './sitemap-proposer'
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
})
