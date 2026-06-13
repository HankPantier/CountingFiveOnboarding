import { describe, expect, it } from 'vitest'
import { crawlSite, normalizeUrl, sameDomain } from './crawl'

describe('normalizeUrl', () => {
  it('resolves relative paths against the base', () => {
    expect(normalizeUrl('/about', 'https://example.com/x/y')).toBe('https://example.com/about')
    expect(normalizeUrl('contact', 'https://example.com/dir/')).toBe(
      'https://example.com/dir/contact',
    )
  })

  it('resolves protocol-relative URLs', () => {
    expect(normalizeUrl('//cdn.example.com/a.js', 'https://example.com')).toBe(
      'https://cdn.example.com/a.js',
    )
  })

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/p#section', 'https://example.com')).toBe(
      'https://example.com/p',
    )
  })

  it('returns null for unparseable URLs', () => {
    expect(normalizeUrl('http://[::bad', 'not a base')).toBeNull()
  })
})

describe('sameDomain', () => {
  it('treats www and bare host as equal', () => {
    expect(sameDomain('https://www.example.com/a', 'example.com')).toBe(true)
    expect(sameDomain('https://example.com/a', 'www.example.com')).toBe(true)
  })

  it('rejects different hosts and subdomains', () => {
    expect(sameDomain('https://other.com', 'example.com')).toBe(false)
    expect(sameDomain('https://blog.example.com', 'example.com')).toBe(false)
  })

  it('does not throw on garbage input', () => {
    expect(sameDomain('not-a-url', 'example.com')).toBe(false)
  })
})

// Live network crawl — opt-in (AUDIT_LIVE_TESTS=1) so the default suite stays
// hermetic. Used to validate the crawler and to capture the golden fixture.
describe.skipIf(!process.env.AUDIT_LIVE_TESTS)('crawlSite (live)', () => {
  it(
    'crawls books.toscrape.com without throwing, capturing pages + status codes',
    async () => {
      const { pages, errors } = await crawlSite('https://books.toscrape.com/', 10)
      expect(pages.length).toBeGreaterThan(0)
      expect(pages.length).toBeLessThanOrEqual(10)
      for (const p of pages) {
        expect(p.status_code).toBe(200)
        expect(p.html.length).toBeGreaterThan(0)
        expect(typeof p.content_length).toBe('number')
      }
      // errors array is well-formed even if empty
      expect(Array.isArray(errors)).toBe(true)
    },
    60_000,
  )
})
