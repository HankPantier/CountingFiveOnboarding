import { describe, expect, it } from 'vitest'
import type { AuditResult, PageSummary } from '@/types/audit-result'
import { mapAuditToContentPlan } from './audit-content-plan'

function summary(over: Partial<PageSummary> & { url: string }): PageSummary {
  return {
    status_code: 200,
    title: over.url,
    title_ok: true,
    title_len: 10,
    meta_desc: '',
    meta_ok: false,
    meta_len: 0,
    h1_count: 1,
    h1_text: '',
    schema_types: [],
    word_count: 500,
    og_complete: false,
    has_ga4: false,
    issues: [],
    content_snippet: '',
    suggested_title: null,
    suggested_meta: null,
    ...over,
  }
}

function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    version: '1.0',
    domain: 'acme.example',
    site_name: 'Acme',
    url: 'https://acme.example',
    audit_date: '2026-06-14',
    max_pages: 50,
    pages_crawled: 0,
    crawl_errors_count: 0,
    overall_score: 50,
    overall_grade: 'F',
    scores: {} as AuditResult['scores'],
    category_scores: {} as AuditResult['category_scores'],
    findings: {} as AuditResult['findings'],
    recommendations: [],
    page_analysis_summary: [],
    google_indexed_urls: [],
    sitemap: {} as AuditResult['sitemap'],
    ...over,
  }
}

describe('mapAuditToContentPlan', () => {
  it('maps live pages to current_sitemap (keep) and proposed_sitemap (update)', () => {
    const r = result({
      page_analysis_summary: [
        summary({ url: 'https://acme.example/', title: 'Home' }),
        summary({ url: 'https://acme.example/services', title: 'Services' }),
      ],
    })
    const plan = mapAuditToContentPlan(r)
    expect(plan.current_sitemap).toHaveLength(2)
    // Absolute crawl URLs are normalized to clean root-relative paths.
    expect(plan.current_sitemap[0]).toMatchObject({ url: '/', action: 'keep', live: true })
    expect(plan.current_sitemap[1]).toMatchObject({ url: '/services', action: 'keep' })
    expect(plan.proposed_sitemap).toHaveLength(2)
    expect(plan.proposed_sitemap[0]).toMatchObject({ status: 'update', title: 'Home', url: '/' })
    expect(plan.summary.pagesFound).toBe(2)
  })

  it('normalizes absolute nested page URLs to root-relative paths (build-safe)', () => {
    // Regression: a team-bio page kept its full absolute URL, which the AI
    // sitemap proposer later mangled into /https-//host.../page — that filename
    // broke `next build` on the generated client site.
    const r = result({
      page_analysis_summary: [
        summary({ url: 'https://www.slachtacpa.com/who-we-are/amy-slachta', title: 'Amy Slachta' }),
      ],
    })
    const plan = mapAuditToContentPlan(r)
    expect(plan.current_sitemap[0].url).toBe('/who-we-are/amy-slachta')
    expect(plan.proposed_sitemap[0].url).toBe('/who-we-are/amy-slachta')
    // No stored URL retains a scheme/host.
    expect([...plan.current_sitemap, ...plan.proposed_sitemap].some(p => /https?:/i.test(p.url))).toBe(false)
  })

  it('dedupes an absolute URL against its already-relative twin after normalization', () => {
    const r = result({
      page_analysis_summary: [
        summary({ url: 'https://acme.example/contact', title: 'Contact' }),
        summary({ url: 'https://acme.example/contact/', title: 'Contact slash' }),
      ],
    })
    const plan = mapAuditToContentPlan(r)
    expect(plan.current_sitemap.filter(c => c.action === 'keep')).toHaveLength(1)
    expect(plan.current_sitemap[0].url).toBe('/contact')
  })

  it('does NOT auto-consolidate distinct pages that merely share a title', () => {
    // A shared <title> is a SEO defect, not a signal to merge distinct pages.
    const r = result({
      page_analysis_summary: [
        summary({ url: 'https://acme.example/a', title: 'Tax Services' }),
        summary({ url: 'https://acme.example/b', title: 'Tax Services' }),
      ],
    })
    const plan = mapAuditToContentPlan(r)
    expect(plan.current_sitemap.map((c) => c.action)).toEqual(['keep', 'keep'])
  })

  it('turns broken pages and redirect-chain origins into redirect entries', () => {
    const r = result({
      page_analysis_summary: [summary({ url: 'https://acme.example/', title: 'Home' })],
      raw: {
        pages: [
          { url: 'https://acme.example/new', original_url: 'https://acme.example/old' },
        ],
        analyzed: [],
        crawl_errors: [{ url: 'https://acme.example/gone', status: 404, error: 'HTTP 404' }],
        psi_mobile: {},
        psi_desktop: {},
        robots: {},
        ssl: {},
        llms: {},
      } as unknown as AuditResult['raw'],
    })
    const plan = mapAuditToContentPlan(r)
    const redirects = plan.current_sitemap.filter((c) => c.action === 'redirect')
    expect(redirects.map((r) => r.url)).toEqual(
      expect.arrayContaining(['https://acme.example/gone', 'https://acme.example/old']),
    )
    const chain = redirects.find((c) => c.url === 'https://acme.example/old')
    expect(chain?.new_url).toBe('https://acme.example/new')
    expect(plan.summary.redirects).toBe(2)
  })

  it('derives content_gaps from thin pages and content findings', () => {
    const r = result({
      page_analysis_summary: [
        summary({ url: 'https://acme.example/thin', title: 'Thin', word_count: 80 }),
        summary({ url: 'https://acme.example/ok', title: 'OK', word_count: 600 }),
      ],
      findings: {
        content: {
          pct_adequate_words: 50,
          avg_reading_grade: 12,
          pct_readable: 80,
          pct_has_cta: 40,
          pct_has_trust_signals: 10,
          homepage_has_contact: false,
          duplicate_title_pages: 0,
        },
      } as AuditResult['findings'],
    })
    const plan = mapAuditToContentPlan(r)
    expect(plan.content_gaps.authorityGaps.some((g) => g.includes('Thin') && g.includes('80 words'))).toBe(true)
    expect(plan.content_gaps.authorityGaps.some((g) => g.includes('50%'))).toBe(true)
    expect(plan.content_gaps.conversionGaps).toContain('Most pages lack a clear call to action.')
    expect(plan.content_gaps.conversionGaps.some((g) => g.includes('trust signals'))).toBe(true)
    expect(plan.content_gaps.conversionGaps.some((g) => g.includes('contact info'))).toBe(true)
    expect(plan.summary.rewriteCandidates).toBe(1)
  })

  it('works for an older audit with no raw (sitemaps only, no redirects)', () => {
    const r = result({
      page_analysis_summary: [summary({ url: 'https://acme.example/', title: 'Home' })],
      raw: undefined,
    })
    const plan = mapAuditToContentPlan(r)
    expect(plan.current_sitemap).toHaveLength(1)
    expect(plan.current_sitemap.every((c) => c.action !== 'redirect')).toBe(true)
    expect(plan.summary.redirects).toBe(0)
  })
})
