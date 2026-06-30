import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn() }))
vi.mock('../serper-search', () => ({
  serperEnabled: vi.fn(() => true),
  serperSearch: vi.fn(),
}))

import { generateMbpJson } from '@/lib/mbp/generate-json'
import { serperEnabled, serperSearch } from '../serper-search'
import { analyzeCompetitors } from './competitors'
import type { DetectedNiche } from '../types'

const mockGen = vi.mocked(generateMbpJson)
const mockSerper = vi.mocked(serperSearch)
const mockEnabled = vi.mocked(serperEnabled)

const niches: DetectedNiche[] = [{ name: 'Dental practices' } as DetectedNiche]
const input = { siteName: 'Acme CPA', domain: 'acme.example', niches, location: 'Austin, TX' }

beforeEach(() => {
  mockGen.mockReset()
  mockSerper.mockReset()
  mockEnabled.mockReturnValue(true)
})

describe('analyzeCompetitors', () => {
  it('returns null when Serper is disabled (no LLM calls)', async () => {
    mockEnabled.mockReturnValue(false)
    expect(await analyzeCompetitors(input)).toBeNull()
    expect(mockGen).not.toHaveBeenCalled()
  })

  it('derives queries, filters own domain + directories, extracts competitors', async () => {
    mockGen.mockResolvedValueOnce({ queries: ['accounting firm Austin TX'] }) // deriveQueries
    mockSerper.mockResolvedValue([
      { position: 1, title: 'Acme CPA', link: 'https://acme.example/', snippet: 'us' },        // own domain → filtered
      { position: 2, title: 'Acme on Yelp', link: 'https://www.yelp.com/biz/acme', snippet: '' }, // directory → filtered
      { position: 3, title: 'Smith CPA', link: 'https://smithcpa.com', snippet: 'Austin CPA' },
      { position: 4, title: 'Jones Accounting', link: 'https://jonesacct.com', snippet: 'tax' },
    ])
    mockGen.mockResolvedValueOnce({
      competitors: [
        { name: 'Smith CPA', location: 'Austin, TX', size: '', nicheClaim: 'dental', positioningNotes: '' },
        { name: 'Jones Accounting', location: 'Austin, TX', size: '', nicheClaim: '', positioningNotes: '' },
      ],
    }) // extractCompetitors

    const out = await analyzeCompetitors(input)
    expect(out?.competitors).toHaveLength(2)
    expect(out?.competitors[0].name).toBe('Smith CPA')

    // The candidate list (indented host lines) should hold only the two
    // non-filtered hosts — never the own domain or the directory host. (The
    // firm's own domain still appears in the instruction text "domain acme…".)
    const extractPrompt = mockGen.mock.calls[1][0] as string
    expect(extractPrompt).toContain('   smithcpa.com')
    expect(extractPrompt).toContain('   jonesacct.com')
    expect(extractPrompt).not.toContain('   yelp.com')
    expect(extractPrompt).not.toContain('   acme.example')
  })

  it('returns null when no candidates survive filtering', async () => {
    mockGen.mockResolvedValueOnce({ queries: ['accounting firm Austin TX'] })
    mockSerper.mockResolvedValue([
      { position: 1, title: 'Acme', link: 'https://acme.example/', snippet: '' },
      { position: 2, title: 'Yelp', link: 'https://yelp.com/x', snippet: '' },
    ])
    expect(await analyzeCompetitors(input)).toBeNull()
    // extraction never runs (only the derive call happened)
    expect(mockGen).toHaveBeenCalledTimes(1)
  })

  it('returns null when query derivation yields nothing', async () => {
    mockGen.mockResolvedValueOnce(null)
    expect(await analyzeCompetitors(input)).toBeNull()
    expect(mockSerper).not.toHaveBeenCalled()
  })
})
