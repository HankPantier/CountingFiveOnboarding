import { describe, expect, it } from 'vitest'
import { normalizeDomain, normalizeInputUrl, runAudit } from './index'

describe('URL normalization', () => {
  it('adds a scheme and strips trailing slashes', () => {
    expect(normalizeInputUrl('example.com/')).toBe('https://example.com')
    expect(normalizeInputUrl('http://example.com//')).toBe('http://example.com')
    expect(normalizeInputUrl('  https://x.com/path/ ')).toBe('https://x.com/path')
  })

  it('normalizes the domain (lowercase, no www)', () => {
    expect(normalizeDomain('https://WWW.Example.com/path')).toBe('example.com')
    expect(normalizeDomain('https://sub.example.com')).toBe('sub.example.com')
  })
})

// Full pipeline — opt-in (AUDIT_LIVE_TESTS=1). Also used to capture the golden
// fixture in Step 11.
describe.skipIf(!process.env.AUDIT_LIVE_TESTS)('runAudit (live)', () => {
  it(
    'returns a complete AuditResult for books.toscrape.com',
    async () => {
      const stages: string[] = []
      const result = await runAudit({
        url: 'https://books.toscrape.com/',
        maxPages: 10,
        onProgress: async (stage) => {
          stages.push(stage)
        },
      })

      expect(result.domain).toBe('books.toscrape.com')
      expect(result.pages_crawled).toBeGreaterThan(0)
      expect(result.overall_score).toBeGreaterThanOrEqual(0)
      expect(result.overall_score).toBeLessThanOrEqual(100)
      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.overall_grade)
      expect(result.page_analysis_summary).toHaveLength(result.pages_crawled)
      expect(Array.isArray(result.recommendations)).toBe(true)
      // recommendations sorted critical-first
      const firstWarn = result.recommendations.findIndex((r) => r.priority === 'warning')
      const lastCrit = result.recommendations.map((r) => r.priority).lastIndexOf('critical')
      if (firstWarn !== -1 && lastCrit !== -1) expect(lastCrit).toBeLessThan(firstWarn)
      // raw inputs persisted for regression
      expect(result.raw?.analyzed).toHaveLength(result.pages_crawled)
      expect(stages).toContain('crawling')
      expect(stages).toContain('scoring')
    },
    120_000,
  )
})
