import { describe, expect, it } from 'vitest'
import type { CrawledPage } from './types'
import { analyzePage, countWords, fleschKincaidGrade } from './analyze-page'

const FIXTURE_HTML = `<!doctype html>
<html>
<head>
  <title>Acme Accounting — Tax & Advisory Services for Small Business</title>
  <meta name="description" content="Acme provides expert tax planning, bookkeeping, and advisory services to small businesses across the region with certified professionals." />
  <link rel="canonical" href="https://acme.example/home" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta property="og:title" content="Acme Accounting" />
  <meta property="og:description" content="Tax and advisory" />
  <meta property="og:image" content="https://acme.example/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},{"@type":"WebSite","url":"https://acme.example"}]}
  </script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('config','G-ABC123XYZ');</script>
  <link rel="stylesheet" href="http://cdn.insecure.example/styles.css" />
</head>
<body>
  <a href="#main" >Skip to content</a>
  <nav><a href="/about">About</a></nav>
  <header><h1>Welcome to Acme Accounting</h1></header>
  <main>
    <h2>Our Services</h2>
    <p>Our certified team offers comprehensive tax planning and bookkeeping for small businesses.
       We have years of experience and a satisfaction guarantee. Ready to get started? Contact us today
       to schedule a consultation. Call our office at (555) 123-4567 or email hello@acme.example.</p>
    <img src="/logo.png" alt="Acme logo" />
    <img src="/banner.png" />
    <a href="/more">click here</a>
    <button></button>
    <form><input type="text" name="q" /></form>
  </main>
  <footer><p>Footer text here</p></footer>
</body>
</html>`

function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: 'https://acme.example/Home?ref=1',
    original_url: 'https://acme.example/Home?ref=1',
    status_code: 200,
    redirect_chain: [],
    redirect_count: 0,
    html: FIXTURE_HTML,
    response_headers: {
      'content-type': 'text/html',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
    ssl_error: false,
    content_length: FIXTURE_HTML.length,
    ...overrides,
  }
}

describe('countWords', () => {
  it('counts word tokens', () => {
    expect(countWords('The cat sat on the mat')).toBe(6)
    expect(countWords('')).toBe(0)
  })
})

describe('fleschKincaidGrade', () => {
  it('returns a number for real text and is deterministic', () => {
    const t = 'The cat sat on the mat. The dog ran in the park. Children played all day.'
    const a = fleschKincaidGrade(t)
    const b = fleschKincaidGrade(t)
    expect(typeof a).toBe('number')
    expect(a).toBe(b)
  })
})

describe('analyzePage', () => {
  const a = analyzePage(makePage())

  it('extracts title + meta description', () => {
    expect(a.title).toContain('Acme Accounting')
    expect(a.title_len).toBe(a.title.length)
    expect(a.meta_desc).toContain('expert tax planning')
    expect(a.meta_desc_len).toBeGreaterThan(0)
  })

  it('detects canonical and indexability', () => {
    expect(a.canonical).toBe('https://acme.example/home')
    expect(a.noindex).toBe(false)
  })

  it('counts headings and one H1', () => {
    expect(a.h1_count).toBe(1)
    expect(a.h1_texts[0]).toContain('Welcome')
    expect(a.h2_count).toBe(1)
  })

  it('detects images + missing alt', () => {
    expect(a.imgs_total).toBe(2)
    expect(a.imgs_missing_alt).toBe(1)
  })

  it('detects OG + Twitter + viewport (booleans)', () => {
    expect(a.og_title).toBe(true)
    expect(a.og_desc).toBe(true)
    expect(a.og_image).toBe(true)
    expect(a.tw_card).toBe(true)
    expect(a.viewport).toBe(true)
  })

  it('extracts schema types from @graph and marks valid', () => {
    expect(a.schema_types.sort()).toEqual(['Organization', 'WebSite'])
    expect(a.schema_valid).toBe(true)
  })

  it('detects CTA, trust, phone, email', () => {
    expect(a.has_cta).toBe(true)
    expect(a.has_trust).toBe(true)
    expect(a.has_phone).toBe(true)
    expect(a.has_email).toBe(true)
  })

  it('detects GA4 and mixed content', () => {
    expect(a.has_ga4).toBe(true)
    expect(a.mixed_content).toBe(true)
    expect(a.mixed_content_urls[0]).toContain('http://cdn.insecure.example/styles.css')
  })

  it('counts security headers from response headers', () => {
    expect(a.sec_headers['x-content-type-options']).toBe(true)
    expect(a.sec_headers['referrer-policy']).toBe(true)
    expect(a.sec_headers['content-security-policy']).toBe(false)
    expect(a.sec_header_count).toBe(2)
  })

  it('flags accessibility gaps + lazy anchors + skip nav', () => {
    expect(a.buttons_missing_label).toBe(1)
    expect(a.inputs_missing_label).toBe(1)
    expect(a.lazy_anchors).toBe(1)
    expect(a.has_skip_nav).toBe(true)
  })

  it('flags URL caps + params', () => {
    expect(a.url_has_params).toBe(true)
    expect(a.url_has_caps).toBe(true)
  })

  it('strips nav/footer/header from body text and computes word count', () => {
    expect(a.word_count).toBeGreaterThan(30)
    // "Footer text here" lives in <footer>, removed before text extraction
    expect(a.page_text_sample).not.toContain('Footer text here')
    expect(a.page_text_sample).toContain('certified team')
  })
})
