import { describe, expect, it } from 'vitest'
import type { CrawledPage } from './types'
import { extractBusinessSignals } from './business-signals'

function page(html: string, url = 'https://acme.example/'): CrawledPage {
  return {
    url,
    original_url: url,
    status_code: 200,
    redirect_chain: [],
    redirect_count: 0,
    html,
    response_headers: {},
    ssl_error: false,
    content_length: html.length,
  }
}

const HOME = `<!doctype html><html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"Organization","name":"Acme Accounting","url":"https://acme.example",
     "telephone":"+1 (555) 123-4567","email":"hello@acme.example",
     "address":{"@type":"PostalAddress","streetAddress":"100 Main St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"},
     "sameAs":["https://www.linkedin.com/company/acme","https://facebook.com/acme"]}
  ]}
  </script>
</head><body>
  <a href="tel:+15559998888">Call</a>
  <a href="mailto:info@acme.example?subject=hi">Email</a>
  <a href="https://twitter.com/acme?ref=footer">Twitter</a>
  <a href="https://acme.example/about">About</a>
  <p>Reach us at (555) 123-4567.</p>
</body></html>`

describe('extractBusinessSignals', () => {
  const s = extractBusinessSignals([page(HOME)])

  it('pulls the organization name from JSON-LD', () => {
    expect(s.organizationName).toBe('Acme Accounting')
  })

  it('collects phones from JSON-LD, tel:, and inline text (deduped)', () => {
    expect(s.phones).toContain('+1 (555) 123-4567')
    expect(s.phones).toContain('+15559998888')
  })

  it('collects emails from JSON-LD and mailto: (strips query)', () => {
    expect(s.emails).toContain('hello@acme.example')
    expect(s.emails).toContain('info@acme.example')
  })

  it('formats the postal address', () => {
    expect(s.addresses[0]).toBe('100 Main St, Austin, TX, 78701')
  })

  it('collects social links from sameAs and anchors, strips query, ignores non-social', () => {
    expect(s.socialLinks).toContain('https://www.linkedin.com/company/acme')
    expect(s.socialLinks).toContain('https://facebook.com/acme')
    expect(s.socialLinks).toContain('https://twitter.com/acme')
    expect(s.socialLinks.some((l) => l.includes('acme.example/about'))).toBe(false)
  })

  it('returns empty signals for a page with nothing', () => {
    const empty = extractBusinessSignals([page('<html><body><p>hi</p></body></html>')])
    expect(empty.organizationName).toBeNull()
    expect(empty.phones).toEqual([])
    expect(empty.socialLinks).toEqual([])
  })
})
