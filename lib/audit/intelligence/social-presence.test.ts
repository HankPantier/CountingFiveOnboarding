import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn() }))
vi.mock('../serper-search', () => ({
  serperEnabled: vi.fn(() => false),
  serperSearch: vi.fn(),
}))
vi.mock('../places-lookup', () => ({
  placesEnabled: vi.fn(() => false),
  lookupPlace: vi.fn(),
}))

import { generateMbpJson } from '@/lib/mbp/generate-json'
import { serperEnabled, serperSearch } from '../serper-search'
import { lookupPlace, placesEnabled } from '../places-lookup'
import { buildSocialPresence, type SocialPresenceInput } from './social-presence'
import type { PlaceDetails } from '../types'

const mockGen = vi.mocked(generateMbpJson)
const mockSerper = vi.mocked(serperSearch)
const mockSerperEnabled = vi.mocked(serperEnabled)
const mockPlaces = vi.mocked(lookupPlace)
const mockPlacesEnabled = vi.mocked(placesEnabled)

function input(overrides: Partial<SocialPresenceInput> = {}): SocialPresenceInput {
  return {
    siteName: 'Acme CPA',
    domain: 'acme.example',
    location: 'Austin, TX',
    socialLinks: [],
    addresses: [],
    onSiteNiches: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockGen.mockReset()
  mockSerper.mockReset()
  mockPlaces.mockReset()
  mockSerperEnabled.mockReturnValue(false)
  mockPlacesEnabled.mockReturnValue(false)
})

describe('buildSocialPresence', () => {
  it('reports GBP + LinkedIn not found when nothing is available', async () => {
    const report = await buildSocialPresence(input())
    expect(report).not.toBeNull()
    expect(report!.hasGbp).toBe(false)
    expect(report!.hasLinkedIn).toBe(false)
    expect(report!.missingRequired).toEqual(['google_business', 'linkedin'])
    const gbp = report!.profiles.find((p) => p.platform === 'google_business')
    expect(gbp?.status).toBe('not_found')
  })

  it('uses authoritative Places data for GBP when a key is present', async () => {
    mockPlacesEnabled.mockReturnValue(true)
    const details: PlaceDetails = {
      name: 'Acme CPA',
      rating: 4.7,
      reviewCount: 42,
      businessStatus: 'OPERATIONAL',
      categories: ['Accountant', 'Tax Preparation'],
      hoursListed: true,
      mapsUri: 'https://maps.google.com/?cid=123',
    }
    mockPlaces.mockResolvedValue(details)

    const report = await buildSocialPresence(input())
    const gbp = report!.profiles.find((p) => p.platform === 'google_business')!
    expect(gbp.source).toBe('places_api')
    expect(gbp.status).toBe('active')
    expect(gbp.usefulness).toBe('high')
    expect(gbp.metrics.rating).toBe(4.7)
    expect(gbp.metrics.reviewCount).toBe(42)
    expect(gbp.url).toBe('https://maps.google.com/?cid=123')
    expect(report!.hasGbp).toBe(true)
  })

  it('falls back to Serper discovery for GBP when Places is unavailable', async () => {
    mockSerperEnabled.mockReturnValue(true)
    mockSerper.mockImplementation(async (q: string) => {
      if (q.includes('google business profile')) {
        return [{ position: 1, title: 'Acme CPA - Google Maps', link: 'https://www.google.com/maps/place/Acme', snippet: '' }]
      }
      return null // the platform-followers query
    })

    const report = await buildSocialPresence(input())
    const gbp = report!.profiles.find((p) => p.platform === 'google_business')!
    expect(gbp.source).toBe('serper')
    expect(gbp.url).toContain('/maps/place/')
    expect(report!.hasGbp).toBe(true)
  })

  it('classifies an on-page GBP link when no lookups run', async () => {
    const report = await buildSocialPresence(
      input({ socialLinks: ['https://g.page/acme-cpa'] }),
    )
    const gbp = report!.profiles.find((p) => p.platform === 'google_business')!
    expect(gbp.source).toBe('onpage')
    expect(gbp.url).toBe('https://g.page/acme-cpa')
    expect(report!.hasGbp).toBe(true)
  })

  it('AI-enriches LinkedIn (company vs personal) and bonus channels from Serper', async () => {
    mockSerperEnabled.mockReturnValue(true)
    mockSerper.mockResolvedValue([
      { position: 1, title: 'Acme CPA | LinkedIn', link: 'https://linkedin.com/company/acme', snippet: '1,200 followers' },
    ])
    mockGen.mockResolvedValue([
      {
        platform: 'linkedin',
        url: 'https://linkedin.com/company/acme',
        status: 'active',
        metrics: { followerCount: 1200, pageType: 'company' },
        usefulness: 'high',
        roomForImprovement: 'Post more frequently.',
        source: 'ai',
      },
      {
        platform: 'instagram',
        url: 'https://instagram.com/acme',
        status: 'dormant',
        metrics: {},
        usefulness: 'low',
        roomForImprovement: 'Revive or remove.',
        source: 'ai',
      },
    ])

    const report = await buildSocialPresence(
      input({ socialLinks: ['https://linkedin.com/company/acme', 'https://instagram.com/acme'] }),
    )
    const li = report!.profiles.find((p) => p.platform === 'linkedin')!
    expect(report!.hasLinkedIn).toBe(true)
    expect(li.metrics.pageType).toBe('company')
    expect(li.metrics.followerCount).toBe(1200)
    const ig = report!.profiles.find((p) => p.platform === 'instagram')!
    expect(ig.status).toBe('dormant')
  })

  it('degrades to a deterministic baseline for a linked LinkedIn when AI yields nothing', async () => {
    mockSerperEnabled.mockReturnValue(true)
    mockSerper.mockResolvedValue([]) // no results → no AI call
    const report = await buildSocialPresence(
      input({ socialLinks: ['https://linkedin.com/company/acme'] }),
    )
    const li = report!.profiles.find((p) => p.platform === 'linkedin')!
    expect(li.status).toBe('unknown')
    expect(li.source).toBe('onpage')
    expect(li.url).toBe('https://linkedin.com/company/acme')
    expect(mockGen).not.toHaveBeenCalled()
  })

  it('does not include bonus channels that are neither linked nor required', async () => {
    const report = await buildSocialPresence(input())
    const platforms = report!.profiles.map((p) => p.platform)
    expect(platforms).toContain('google_business')
    expect(platforms).toContain('linkedin')
    expect(platforms).not.toContain('facebook')
    expect(platforms).not.toContain('x')
  })
})
