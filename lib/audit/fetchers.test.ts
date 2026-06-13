import { describe, expect, it, vi } from 'vitest'
import { fetchLlmsTxt, fetchRobots, fetchSitemap } from './fetch-meta'
import { checkSsl } from './ssl'
import { checkPageSpeed } from './pagespeed'
import { checkGoogleIndex } from './index-check'

describe('graceful degradation (no network)', () => {
  it('checkSsl rejects non-HTTPS without connecting', async () => {
    const r = await checkSsl('http://example.com')
    expect(r).toEqual({ valid: false, expiry_days: null, error: 'Not using HTTPS' })
  })

  it('checkGoogleIndex returns "unverified" when SERPER_API_KEY is absent', async () => {
    vi.stubEnv('SERPER_API_KEY', '')
    const r = await checkGoogleIndex('example.com')
    expect(r).toEqual({ google_index_count: 'unverified', google_indexed_urls: [] })
    vi.unstubAllEnvs()
  })
})

// Live network checks — opt-in (AUDIT_LIVE_TESTS=1).
describe.skipIf(!process.env.AUDIT_LIVE_TESTS)('fetchers (live)', () => {
  const base = 'https://books.toscrape.com/'

  it('fetchRobots returns a well-formed result', async () => {
    const r = await fetchRobots(base)
    expect(typeof r.present).toBe('boolean')
    expect(Array.isArray(r.sitemaps)).toBe(true)
    expect(Array.isArray(r.ai_blocked)).toBe(true)
  })

  it('fetchSitemap returns a well-formed result', async () => {
    const r = await fetchSitemap(base)
    expect(typeof r.found).toBe('boolean')
    expect(typeof r.count).toBe('number')
    expect(Array.isArray(r.page_entries)).toBe(true)
  })

  it('fetchLlmsTxt returns a well-formed result', async () => {
    const r = await fetchLlmsTxt(base)
    expect(typeof r.present).toBe('boolean')
    expect(r.url).toContain('/llms.txt')
  })

  it('checkSsl reports a valid cert with expiry days', async () => {
    const r = await checkSsl(base)
    expect(r.valid).toBe(true)
    expect(typeof r.expiry_days).toBe('number')
  })

  it('checkPageSpeed degrades gracefully (score or error)', async () => {
    const r = await checkPageSpeed(base, 'mobile')
    if (r.score === null) expect(typeof r.error).toBe('string')
    else expect(typeof r.score).toBe('number')
  }, 40_000)

  it('checkGoogleIndex returns a numeric count + urls with a key', async () => {
    const r = await checkGoogleIndex('books.toscrape.com')
    expect(typeof r.google_index_count === 'number' || r.google_index_count === 'unverified').toBe(
      true,
    )
    expect(Array.isArray(r.google_indexed_urls)).toBe(true)
  })
})
