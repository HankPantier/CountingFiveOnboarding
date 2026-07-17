import { describe, expect, it } from 'vitest'
import type { AuditResult, CategoryScoreMap, Grade } from '@/types/audit-result'
import { buildAuditHtml } from './html-report'

function cat(score: number): { score: number; grade: Grade } {
  const grade: Grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'
  return { score, grade }
}

const CATEGORY_SCORES: CategoryScoreMap = {
  performance: cat(95),
  technical: cat(72),
  onpage_seo: cat(64),
  ux: cat(48),
  content: cat(80),
  indexability: cat(55),
  schema: cat(40),
  ai_llm: cat(20),
  analytics: cat(60),
  local_seo: cat(35),
}

function result(): AuditResult {
  return {
    version: '1.0',
    domain: 'acme.example',
    site_name: 'Acme CPAs',
    url: 'https://acme.example',
    audit_date: '2026-06-19',
    max_pages: 50,
    pages_crawled: 8,
    crawl_errors_count: 1,
    overall_score: 65,
    overall_grade: 'D',
    scores: {} as AuditResult['scores'],
    category_scores: CATEGORY_SCORES,
    findings: {} as AuditResult['findings'],
    recommendations: [],
    page_analysis_summary: [],
    google_indexed_urls: [],
    sitemap: {} as AuditResult['sitemap'],
    intelligence: {
      target_market: { score: 72, grade: 'C', sub_scores: {}, commentary: '' },
      competitive: { score: 61, grade: 'D', sub_scores: {}, commentary: '', keyword_rankings: [], ai_search_presence: '', local_seo: '' },
      niche_services: { score: 38, grade: 'F', sub_scores: {}, commentary: '', detected_niches: [], invisible_niches: [], services_analysis: [], top_improvements: [] },
      tech_stack: { cms: 'WordPress', page_builder: null, hosting: null, frameworks: [], risk_flags: [], commentary: '' },
      narrative: {
        executive_summary: 'The site has solid speed but weak niche positioning.',
        section_commentary: { target_market: 'Visitors cannot tell who you serve.' },
        recommendations: [
          { title: 'Build real niche pages', business_impact: 'Wins industry searches.', counting_five_help: 'Revaltus can build conversion-focused niche pages.', priority: 'High' },
        ],
      },
    },
  }
}

describe('buildAuditHtml — parity with the shareable design target', () => {
  const html = buildAuditHtml({ result: result(), createdAt: '2026-06-19T00:00:00Z' })

  it('renders the hero on the 0–10 scale', () => {
    expect(html).toContain('out of 10')
    expect(html).not.toContain('out of 100')
  })

  it('shows the Passing / Need Work hero pills', () => {
    expect(html).toMatch(/\d+ Passing/)
    expect(html).toMatch(/\d+ Need Work/)
  })

  it('renders all eight client-facing dashboard cards', () => {
    for (const label of [
      'Target Market Clarity',
      'Competitive Search Visibility',
      'Niche &amp; Services Intelligence',
      'SEO / AIO / GEO Health',
      'Mobile Responsiveness',
      'Site Speed &amp; Performance',
      'Technology Stack',
      'Site Age, Health &amp; Errors',
    ]) {
      expect(html).toContain(label)
    }
  })

  it('labels section narrative as "What This Means"', () => {
    expect(html).toContain('What This Means')
  })

  it('renders the recommendations table with a Revaltus Service column', () => {
    expect(html).toContain('Issue &amp; Impact')
    expect(html).toContain('Revaltus Service')
    expect(html).toContain('Revaltus can build conversion-focused niche pages.')
  })

  it('uses +/- letter grades', () => {
    // performance 95 → A; ux 48 → F; the +/- scale must appear somewhere.
    expect(html).toMatch(/[ABCDF][+-]?\s·\s\d/)
  })
})
