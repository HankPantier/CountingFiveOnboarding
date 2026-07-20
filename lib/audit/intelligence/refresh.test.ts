import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./social-presence', () => ({ buildSocialPresence: vi.fn() }))
vi.mock('./narrative', () => ({ buildNarrative: vi.fn() }))

import { buildSocialPresence } from './social-presence'
import { buildNarrative } from './narrative'
import { refreshAuditIntelligence } from './index'
import type { AuditIntelligence, AuditResult, SocialPresenceReport } from '../types'

const mockSocial = vi.mocked(buildSocialPresence)
const mockNarr = vi.mocked(buildNarrative)

function report(): SocialPresenceReport {
  return {
    profiles: [
      { platform: 'google_business', url: 'https://maps.google.com/?cid=1', status: 'active', metrics: {}, usefulness: 'high', roomForImprovement: '', source: 'places_api' },
    ],
    hasGbp: true,
    hasLinkedIn: false,
    missingRequired: ['linkedin'],
    summary: '',
  }
}

function result(): AuditResult {
  const intelligence: AuditIntelligence = {
    niche_services: { detected_niches: [{ name: 'Dental practices', signal: 'strong', note: '' }] } as AuditIntelligence['niche_services'],
    tech_stack: { cms: 'WordPress', page_builder: null, hosting: null, frameworks: [], risk_flags: [], commentary: '' },
    narrative: { executive_summary: 'old', section_commentary: {}, recommendations: [] },
  }
  return {
    site_name: 'Acme CPA',
    domain: 'acme.example',
    business_signals: { organizationName: 'Acme CPA', phones: [], emails: [], addresses: ['100 Main St, Austin, TX 78701'], socialLinks: ['https://linkedin.com/company/acme'] },
    recommendations: [],
    intelligence,
  } as unknown as AuditResult
}

beforeEach(() => {
  mockSocial.mockReset()
  mockNarr.mockReset()
})

describe('refreshAuditIntelligence', () => {
  it('recomputes social presence, re-runs the narrative, and preserves other sections', async () => {
    const sp = report()
    mockSocial.mockResolvedValue(sp)
    mockNarr.mockResolvedValue({ executive_summary: 'new', section_commentary: {}, recommendations: [] })

    const intel = await refreshAuditIntelligence(result(), { auditId: 'a1' })
    expect(intel?.social_presence).toBe(sp)
    expect(intel?.narrative?.executive_summary).toBe('new')
    expect(intel?.tech_stack?.cms).toBe('WordPress') // crawl-dependent section preserved

    // Social links + derived niches/location were passed to the builder.
    const spInput = mockSocial.mock.calls[0][0]
    expect(spInput.socialLinks).toContain('https://linkedin.com/company/acme')
    expect(spInput.onSiteNiches).toEqual(['Dental practices'])
    expect(spInput.location).toBe('Austin, TX')

    // The narrative saw the intel WITH the refreshed social presence.
    const passedIntel = mockNarr.mock.calls[0][1]
    expect(passedIntel.social_presence).toBe(sp)
  })

  it('still returns the bundle when the social pass yields nothing', async () => {
    mockSocial.mockResolvedValue(null)
    mockNarr.mockResolvedValue({ executive_summary: 'n', section_commentary: {}, recommendations: [] })
    const intel = await refreshAuditIntelligence(result())
    expect(intel?.social_presence).toBeUndefined()
    expect(intel?.tech_stack).toBeDefined()
  })
})
