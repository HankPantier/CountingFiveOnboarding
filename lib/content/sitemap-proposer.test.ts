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

    // existing live pages → updates (redirect/non-live excluded)
    expect(byUrl['https://acme.example/'].status).toBe('update')
    expect(byUrl['https://acme.example/about'].status).toBe('update')
    expect(byUrl['https://acme.example/gone']).toBeUndefined()

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
    expect(out.map(p => p.url)).toContain('https://x.example/')
    expect(out.map(p => p.url)).not.toContain('https://x.example/404')
    expect(out.every(p => p.status === 'update')).toBe(true)
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
