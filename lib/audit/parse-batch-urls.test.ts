import { describe, expect, it } from 'vitest'
import { parseBatchUrls } from './parse-batch-urls'

describe('parseBatchUrls', () => {
  it('splits a textarea blob on newlines and adds a scheme', () => {
    const { valid } = parseBatchUrls('example.com\nacme-accounting.ca')
    expect(valid).toEqual([
      { url: 'https://example.com', domain: 'example.com' },
      { url: 'https://acme-accounting.ca', domain: 'acme-accounting.ca' },
    ])
  })

  it('trims whitespace and drops blank lines', () => {
    const { valid } = parseBatchUrls('  example.com  \n\n\t\n  foo.com\n')
    expect(valid.map((v) => v.url)).toEqual(['https://example.com', 'https://foo.com'])
  })

  it('dedupes repeated URLs, preserving first-seen order', () => {
    const { valid } = parseBatchUrls('example.com\nhttps://example.com\nexample.com/')
    expect(valid).toEqual([{ url: 'https://example.com', domain: 'example.com' }])
  })

  it('strips www from the domain but keeps subdomains distinct', () => {
    const { valid } = parseBatchUrls('www.example.com\nblog.example.com')
    expect(valid).toEqual([
      { url: 'https://www.example.com', domain: 'example.com' },
      { url: 'https://blog.example.com', domain: 'blog.example.com' },
    ])
  })

  it('sends malformed entries to invalid without dropping the good ones', () => {
    // normalizeInputUrl force-prepends https://, so only genuinely unparseable
    // entries (bad port, spaces) throw. Same quirk as the single-audit route;
    // the real public-URL/SSRF gate runs later at fetch time, not here.
    const { valid, invalid } = parseBatchUrls('javascript:alert(1)\nfoo bar baz\nexample.com')
    expect(valid.map((v) => v.url)).toEqual(['https://example.com'])
    expect(invalid).toEqual(['javascript:alert(1)', 'foo bar baz'])
  })

  it('accepts a pre-split array as well as a blob', () => {
    const { valid } = parseBatchUrls(['example.com', ' foo.com '])
    expect(valid.map((v) => v.domain)).toEqual(['example.com', 'foo.com'])
  })

  it('returns empty for empty input', () => {
    expect(parseBatchUrls('')).toEqual({ valid: [], invalid: [] })
    expect(parseBatchUrls('   \n\n  ')).toEqual({ valid: [], invalid: [] })
  })
})
