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
import { buildTeamSocial, extractTeamText, type TeamSocialInput } from './team-social'
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

  it('assembles a report from roster + synthesis', async () => {
    mockSafeGet.mockResolvedValue(
      htmlPage('https://acme.example', '<body><h2>Jane Doe, CPA</h2></body>'),
    )
    mockGen
      .mockResolvedValueOnce([
        { name: 'Jane Doe', title: 'Partner', certifications: ['CPA'], specializations: ['Tax'], bio: '' },
      ])
      .mockResolvedValueOnce({
        members: [
          {
            name: 'Jane Doe',
            title: 'Partner',
            certifications: ['CPA'],
            specializations: ['Tax'],
            socialProfiles: [
              {
                platform: 'linkedin',
                url: 'https://www.linkedin.com/in/janedoe',
                status: 'active',
                metrics: {},
                usefulness: 'high',
                roomForImprovement: 'Post weekly',
                source: 'ai',
              },
            ],
            footprint: 'moderate',
            roomForImprovement: 'Grow following',
            nicheOpportunities: ['Restaurant tax credits'],
            source: 'ai',
          },
        ],
        teamNicheOpportunities: ['Restaurant accounting'],
      })

    const report = await buildTeamSocial(input())
    expect(report).not.toBeNull()
    expect(report!.members).toHaveLength(1)
    expect(report!.members[0].socialProfiles[0].platform).toBe('linkedin')
    expect(report!.teamNicheOpportunities).toContain('Restaurant accounting')
    expect(report!.membersDropped).toBe(0)
  })

  it('falls back to a baseline roster when synthesis fails', async () => {
    mockSafeGet.mockResolvedValue(
      htmlPage('https://acme.example', '<body><h2>Jane Doe</h2></body>'),
    )
    mockGen
      .mockResolvedValueOnce([
        { name: 'Jane Doe', title: 'Partner', certifications: [], specializations: [], bio: '' },
      ])
      .mockResolvedValueOnce(null) // synthesis failed

    const report = await buildTeamSocial(input())
    expect(report!.members[0].source).toBe('onpage')
    expect(report!.members[0].footprint).toBe('minimal')
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
