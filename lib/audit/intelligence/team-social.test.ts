import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn() }))
vi.mock('../serper-search', () => ({
  serperEnabled: vi.fn(() => false),
  serperSearch: vi.fn(),
}))
vi.mock('../crawl', async (orig) => {
  const actual = await orig<typeof import('../crawl')>()
  return { ...actual, safeGet: vi.fn() }
})

import { generateMbpJson } from '@/lib/mbp/generate-json'
import { serperEnabled, serperSearch } from '../serper-search'
import { safeGet } from '../crawl'
import { buildTeamSocial, extractTeamText, findBioPages, type TeamSocialInput } from './team-social'
import { generateTeamSocialRecommendations } from '../recommendations'
import type { TeamSocialReport } from '../types'

const mockGen = vi.mocked(generateMbpJson)
const mockSafeGet = vi.mocked(safeGet)
const mockSerperEnabled = vi.mocked(serperEnabled)
const mockSerperSearch = vi.mocked(serperSearch)

function input(overrides: Partial<TeamSocialInput> = {}): TeamSocialInput {
  return {
    siteName: 'Acme CPA',
    domain: 'acme.example',
    websiteUrl: 'https://acme.example',
    location: 'Austin, TX',
    onSiteNiches: ['Restaurants'],
    ...overrides,
  }
}

function htmlPage(finalUrl: string, body: string) {
  return { status: 200, contentType: 'text/html', body, finalUrl } as Awaited<ReturnType<typeof safeGet>>
}

beforeEach(() => {
  mockGen.mockReset()
  mockSafeGet.mockReset()
  mockSerperEnabled.mockReturnValue(false)
  mockSerperSearch.mockReset()
})

describe('extractTeamText', () => {
  it('extracts readable text, strips scripts, and harvests social links', () => {
    const html = `<html><body>
      <nav>Home</nav>
      <script>var secret = 1</script>
      <h2>Jane Doe, CPA</h2><p>Tax specialist.</p>
      <a href="https://www.linkedin.com/in/janedoe">LinkedIn</a>
      <a href="/about">About</a>
    </body></html>`
    const { text, socialLinks } = extractTeamText(html, 'https://acme.example/team')
    expect(text).toContain('Jane Doe, CPA')
    expect(text).not.toContain('secret')
    expect(socialLinks).toEqual(['https://www.linkedin.com/in/janedoe'])
  })
})

describe('findBioPages', () => {
  it('finds one-segment-deeper same-domain bio links under a team page', () => {
    const html = `
      <a href="/who-we-are/david-lattimore">David Lattimore</a>
      <a href="/who-we-are/erik-angelle">Erik Angelle</a>
      <a href="/who-we-are">Back to team</a>
      <a href="/who-we-are/david/awards">Awards</a>
      <a href="/contact">Contact</a>
      <a href="/who-we-are/roster.pdf">PDF</a>
    `
    const urls = findBioPages(html, 'https://acme.example/who-we-are')
    expect(urls).toContain('https://acme.example/who-we-are/david-lattimore')
    expect(urls).toContain('https://acme.example/who-we-are/erik-angelle')
    expect(urls).not.toContain('https://acme.example/who-we-are') // the page itself
    expect(urls).not.toContain('https://acme.example/who-we-are/david/awards') // 2 segments deep
    expect(urls).not.toContain('https://acme.example/contact') // not under base
    expect(urls.some((u) => u.endsWith('.pdf'))).toBe(false) // asset, skipped
  })

  it('returns nothing for a homepage/root base', () => {
    expect(findBioPages('<a href="/about/x">x</a>', 'https://acme.example/')).toEqual([])
  })
})

describe('buildTeamSocial', () => {
  it('returns null when the site could not be scraped', async () => {
    mockSafeGet.mockResolvedValue(null)
    expect(await buildTeamSocial(input())).toBeNull()
  })

  it('returns null when no roster is extracted', async () => {
    mockSafeGet.mockResolvedValue(htmlPage('https://acme.example', '<body>No team here</body>'))
    mockGen.mockResolvedValueOnce(null) // roster extraction produced nothing
    expect(await buildTeamSocial(input())).toBeNull()
  })

  it('maps niche opportunities from credentials even with no social footprint', async () => {
    mockSafeGet.mockResolvedValue(
      htmlPage('https://acme.example', '<body><h2>Jane Doe, CPA</h2></body>'),
    )
    mockGen
      // 1) roster extraction
      .mockResolvedValueOnce([
        { name: 'Jane Doe', title: 'Partner', certifications: ['CVA'], specializations: ['Valuation'], bio: '' },
      ])
      // 2) niche mapping (Pass A) — Serper disabled so Pass B does not run
      .mockResolvedValueOnce({
        perMember: { 'Jane Doe': ['Business valuation for divorce settlements'] },
        team: ['M&A advisory content'],
      })

    const report = await buildTeamSocial(input())
    expect(report).not.toBeNull()
    expect(report!.members[0].nicheOpportunities).toContain('Business valuation for divorce settlements')
    expect(report!.teamNicheOpportunities).toContain('M&A advisory content')
    // No social signal → minimal footprint, honest (not "system failed") message.
    expect(report!.members[0].footprint).toBe('minimal')
    expect(report!.members[0].source).toBe('onpage')
    expect(report!.members[0].roomForImprovement).toMatch(/LinkedIn/)
  })

  it('assesses the social footprint of members Serper surfaces', async () => {
    mockSerperEnabled.mockReturnValue(true)
    mockSerperSearch.mockResolvedValue([
      { position: 1, title: 'Jane Doe | LinkedIn', link: 'https://www.linkedin.com/in/janedoe', snippet: 'Partner at Acme CPA' },
    ])
    mockSafeGet.mockResolvedValue(
      htmlPage('https://acme.example', '<body><h2>Jane Doe, CPA</h2></body>'),
    )
    mockGen
      .mockResolvedValueOnce([
        { name: 'Jane Doe', title: 'Partner', certifications: ['CPA'], specializations: [], bio: '' },
      ]) // roster
      .mockResolvedValueOnce(null) // external enrichment (no-op here)
      .mockResolvedValueOnce({ perMember: {}, team: ['Local business tax'] }) // niche
      .mockResolvedValueOnce(
        new Map([
          [
            'Jane Doe',
            {
              socialProfiles: [
                { platform: 'linkedin', url: 'https://www.linkedin.com/in/janedoe', status: 'active', metrics: {}, usefulness: 'high', roomForImprovement: 'Post weekly', source: 'ai' },
                { platform: 'x', url: 'https://x.com/janedoe', status: 'dormant', metrics: {}, usefulness: 'low', roomForImprovement: 'Revive or drop it', source: 'ai' },
              ],
              footprint: 'moderate',
              roomForImprovement: 'Grow following',
            },
          ],
        ]),
      ) // social assessment (Pass B) — multiple platforms per person

    const report = await buildTeamSocial(input())
    const platforms = report!.members[0].socialProfiles.map((p) => p.platform)
    expect(platforms).toContain('linkedin')
    expect(platforms).toContain('x')
    expect(report!.members[0].footprint).toBe('moderate')
    expect(report!.members[0].source).toBe('ai')
    // Discovery is platform-agnostic, not LinkedIn-only.
    expect(mockSerperSearch.mock.calls[0][0]).toMatch(/instagram/)
    expect(mockSerperSearch.mock.calls[0][0]).toMatch(/facebook/)
  })

  it('enriches thin on-site roster with external credentials before niche mapping', async () => {
    mockSerperEnabled.mockReturnValue(true)
    mockSerperSearch.mockResolvedValue([
      { position: 1, title: 'David Lattimore, CVA', link: 'https://directory.example/david', snippet: 'Certified Valuation Analyst, construction accounting' },
    ])
    mockSafeGet.mockResolvedValue(
      htmlPage('https://acme.example', '<body><h2>David Lattimore, CPA</h2></body>'),
    )
    let nichePromptSawCVA = false
    mockGen
      .mockResolvedValueOnce([
        { name: 'David Lattimore', title: 'Managing Partner', certifications: ['CPA'], specializations: [], bio: '' },
      ]) // roster (name + title only, as on the site)
      .mockResolvedValueOnce(
        new Map([['David Lattimore', { certifications: ['CVA'], specializations: ['Construction accounting'], bioAddendum: '' }]]),
      ) // external enrichment
      .mockImplementationOnce(async (prompt: string) => {
        nichePromptSawCVA = prompt.includes('CVA') && prompt.includes('Construction accounting')
        return { perMember: { 'David Lattimore': ['Business valuation for M&A'] }, team: [] }
      }) // niche mapping — should see the enriched credentials
      .mockResolvedValueOnce(new Map()) // social

    const report = await buildTeamSocial(input())
    // External CVA + construction expertise merged into the roster member...
    expect(report!.members[0].certifications).toContain('CVA')
    expect(report!.members[0].specializations).toContain('Construction accounting')
    // ...and the niche-mapping pass received them.
    expect(nichePromptSawCVA).toBe(true)
    expect(report!.members[0].nicheOpportunities).toContain('Business valuation for M&A')
  })

  it('scrapes a team page from the crawl inventory when the homepage does not link it', async () => {
    // Homepage has no recognizable team link; the roster lives at /who-we-are,
    // which the audit already crawled (knownUrls).
    mockSafeGet.mockImplementation(async (url: string) => {
      if (url === 'https://acme.example') return htmlPage('https://acme.example', '<body>Welcome</body>')
      if (url === 'https://acme.example/who-we-are') return htmlPage(url, '<body><h2>Jane Doe, CPA</h2></body>')
      return null
    })
    mockGen
      .mockResolvedValueOnce([
        { name: 'Jane Doe', title: 'Partner', certifications: ['CPA'], specializations: [], bio: '' },
      ])
      .mockResolvedValueOnce({ perMember: {}, team: [] })

    const report = await buildTeamSocial(input({ knownUrls: ['https://acme.example/who-we-are'] }))
    expect(mockSafeGet).toHaveBeenCalledWith('https://acme.example/who-we-are')
    expect(report!.members[0].name).toBe('Jane Doe')
  })

  it('still lists the roster when niche mapping fails', async () => {
    mockSafeGet.mockResolvedValue(
      htmlPage('https://acme.example', '<body><h2>Jane Doe</h2></body>'),
    )
    mockGen
      .mockResolvedValueOnce([
        { name: 'Jane Doe', title: 'Partner', certifications: [], specializations: [], bio: '' },
      ])
      .mockResolvedValueOnce(null) // niche mapping failed

    const report = await buildTeamSocial(input())
    expect(report!.members[0].source).toBe('onpage')
    expect(report!.members[0].footprint).toBe('minimal')
    expect(report!.members[0].nicheOpportunities).toEqual([])
  })
})

describe('generateTeamSocialRecommendations', () => {
  function report(overrides: Partial<TeamSocialReport> = {}): TeamSocialReport {
    return {
      members: [],
      teamNicheOpportunities: [],
      summary: '',
      membersAssessed: 0,
      membersDropped: 0,
      ...overrides,
    }
  }

  it('flags members with no findable footprint and maps niche opportunities', () => {
    const recs = generateTeamSocialRecommendations(
      report({
        members: [
          {
            name: 'Jane Doe',
            certifications: ['CPA'],
            specializations: [],
            socialProfiles: [],
            footprint: 'minimal',
            roomForImprovement: '',
            nicheOpportunities: ['Restaurant tax'],
            source: 'ai',
          },
        ],
        teamNicheOpportunities: ['Restaurant accounting'],
      }),
    )
    const titles = recs.map((r) => r.title)
    expect(titles).toContain('Build Out Your Team’s LinkedIn Presence')
    expect(titles).toContain('Turn Team Expertise Into Niche Content')
    expect(recs.every((r) => r.category === 'Team & Expertise')).toBe(true)
  })

  it('returns nothing for an empty roster', () => {
    expect(generateTeamSocialRecommendations(report())).toEqual([])
  })
})
