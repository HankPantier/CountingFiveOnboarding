import { describe, expect, it } from 'vitest'
import type {
  AuditResult,
  CategoryScoreMap,
  CompetitiveIntelligence,
  Grade,
  NicheServicesIntelligence,
} from '@/types/audit-result'
import { deriveDashboard, inferSection, passingCounts, siteHealthExtraRows } from './report-buckets'

function cat(score: number | null): { score: number | null; grade: Grade | null } {
  const grade: Grade | null =
    score === null ? null : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'
  return { score, grade }
}

const CATEGORY_SCORES: CategoryScoreMap = {
  performance: cat(90),
  technical: cat(70),
  onpage_seo: cat(60),
  ux: cat(50),
  content: cat(80),
  indexability: cat(40),
  schema: cat(40),
  ai_llm: cat(20),
  analytics: cat(60),
}

function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    version: '1.0',
    domain: 'acme.example',
    site_name: 'Acme',
    url: 'https://acme.example',
    audit_date: '2026-06-19',
    max_pages: 50,
    pages_crawled: 5,
    crawl_errors_count: 2,
    overall_score: 55,
    overall_grade: 'F',
    scores: {} as AuditResult['scores'],
    category_scores: CATEGORY_SCORES,
    findings: {} as AuditResult['findings'],
    recommendations: [],
    page_analysis_summary: [],
    google_indexed_urls: [],
    sitemap: {} as AuditResult['sitemap'],
    ...over,
  }
}

const scored = (score: number) => ({ score, grade: 'C' as Grade, sub_scores: {}, commentary: '' })
const comp = (score: number): CompetitiveIntelligence => ({
  ...scored(score),
  keyword_rankings: [],
  ai_search_presence: '',
  local_seo: '',
})
const niche = (score: number): NicheServicesIntelligence => ({
  ...scored(score),
  detected_niches: [],
  invisible_niches: [],
  services_analysis: [],
  top_improvements: [],
})

describe('deriveDashboard', () => {
  it('produces the eight client-facing cards in order when intelligence is present', () => {
    const r = result({
      intelligence: {
        target_market: scored(7),
        competitive: comp(6),
        niche_services: niche(4),
        tech_stack: { cms: 'WordPress', page_builder: null, hosting: null, frameworks: [], risk_flags: ['polyfill.io'], commentary: '' },
      },
    })
    const cards = deriveDashboard(r)
    expect(cards.map((c) => c.label)).toEqual([
      'Target Market Clarity',
      'Competitive Search Visibility',
      'Niche & Services Intelligence',
      'SEO / AIO / GEO Health',
      'Mobile Responsiveness',
      'Site Speed & Performance',
      'Technology Stack',
      'Site Age, Health & Errors',
    ])
  })

  it('normalizes intel 0–10 scores to the 0–100 axis', () => {
    const r = result({ intelligence: { target_market: scored(7) } })
    const tm = deriveDashboard(r).find((c) => c.key === 'target_market')
    expect(tm?.score).toBe(70)
  })

  it('passes single-category composites straight through', () => {
    const speed = deriveDashboard(result()).find((c) => c.key === 'speed')
    expect(speed?.score).toBe(90) // performance
    const mobile = deriveDashboard(result()).find((c) => c.key === 'mobile')
    expect(mobile?.score).toBe(50) // ux
  })

  it('weight-averages multi-category composites (Site Health = technical .7 + analytics .3)', () => {
    const sh = deriveDashboard(result()).find((c) => c.key === 'site_health')
    expect(sh?.score).toBe(Math.round(70 * 0.7 + 60 * 0.3)) // 67
  })

  it('derives a tech-stack grade from risk-flag count', () => {
    const clean = deriveDashboard(
      result({ intelligence: { tech_stack: { cms: null, page_builder: null, hosting: null, frameworks: [], risk_flags: [], commentary: '' } } }),
    ).find((c) => c.key === 'tech_stack')
    expect(clean?.score).toBe(92)
    const risky = deriveDashboard(
      result({ intelligence: { tech_stack: { cms: null, page_builder: null, hosting: null, frameworks: [], risk_flags: ['a', 'b'], commentary: '' } } }),
    ).find((c) => c.key === 'tech_stack')
    expect(risky?.score).toBe(64)
  })

  it('omits intel cards (incl. tech stack) when intelligence is absent', () => {
    const cards = deriveDashboard(result())
    expect(cards.map((c) => c.key)).toEqual(['seo_aio_geo', 'mobile', 'speed', 'site_health'])
  })
})

describe('passingCounts', () => {
  it('counts A/B (≥80) as passing, C and below as needs-work', () => {
    const cards = deriveDashboard(result({ intelligence: { target_market: scored(9) } }))
    // target_market 90 (pass), seo ~ low (work), mobile 50 (work), speed 90 (pass), site_health 67 (work)
    const { passing, needsWork } = passingCounts(cards)
    expect(passing).toBe(2)
    expect(needsWork).toBe(3)
  })
})

describe('siteHealthExtraRows', () => {
  it('includes domain age and crawl errors when available', () => {
    const rows = siteHealthExtraRows(
      result({ crawl_errors_count: 3, intelligence: { domain: { registered: '2010-01-01', age_years: 16, last_updated: '2026-05-01' } } }),
    )
    expect(rows).toContainEqual({ label: 'Domain Age', value: '16 years' })
    expect(rows).toContainEqual({ label: 'Crawl Errors', value: '3' })
  })

  it('always reports crawl errors even with no domain intel', () => {
    expect(siteHealthExtraRows(result({ crawl_errors_count: 0 }))).toEqual([{ label: 'Crawl Errors', value: '0' }])
  })
})

describe('inferSection', () => {
  it('attributes a recommendation to a report section by keyword', () => {
    expect(inferSection('Build real niche pages for the four verticals')).toBe('Niche & Services Intelligence')
    expect(inferSection('Fix the mobile load time')).toBe('Site Speed & Performance')
    expect(inferSection('Add LocalBusiness schema and fix the H1')).toBe('SEO / AIO / GEO Health')
  })
  it('falls back to an em dash when nothing matches', () => {
    expect(inferSection('Something entirely unrelated')).toBe('—')
  })
})
