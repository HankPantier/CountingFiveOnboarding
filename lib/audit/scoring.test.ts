import { describe, expect, it } from 'vitest'
import type { CategoryScores, CrawledPage, PageAnalysis } from './types'
import {
  computeOverall,
  computeScores,
  getGrade,
  pyRound,
  scoreCategory,
  type ComputeScoresInput,
} from './scoring'

describe('pyRound (Python round-half-to-even parity)', () => {
  it('rounds halves to even, not up', () => {
    expect(pyRound(0.5)).toBe(0)
    expect(pyRound(1.5)).toBe(2)
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(12.5)).toBe(12)
    expect(pyRound(13.5)).toBe(14)
  })

  it('rounds non-halves normally', () => {
    expect(pyRound(77.77)).toBe(78)
    expect(pyRound(55.125)).toBe(55)
    expect(pyRound(23.4)).toBe(23)
  })

  it('rounds to N digits', () => {
    expect(pyRound(2.0, 1)).toBe(2)
    expect(pyRound(13.94, 1)).toBe(13.9)
    expect(pyRound(2.05, 1)).toBe(2.0) // half-to-even at the tenths place
  })
})

describe('getGrade (audit.py GRADE_SCALE)', () => {
  it('maps scores to letters at the right thresholds', () => {
    expect(getGrade(100)).toBe('A')
    expect(getGrade(90)).toBe('A')
    expect(getGrade(89)).toBe('B')
    expect(getGrade(80)).toBe('B')
    expect(getGrade(70)).toBe('C')
    expect(getGrade(60)).toBe('D')
    expect(getGrade(59)).toBe('F')
    expect(getGrade(0)).toBe('F')
  })
})

describe('scoreCategory (weighted pass ratio)', () => {
  it('returns 100 when no checks', () => {
    expect(scoreCategory([])).toBe(100)
  })

  it('returns the rounded weighted pass percentage', () => {
    // All passed → 100
    expect(
      scoreCategory([
        [true, 2],
        [true, 1],
      ]),
    ).toBe(100)
    // None passed → 0
    expect(
      scoreCategory([
        [false, 2],
        [false, 1],
      ]),
    ).toBe(0)
  })

  it("reproduces the sample's indexability score (3.5 / 4.5 → 78)", () => {
    // sitemap_found(2.0)=pass, sitemap_in_robots(1.0)=fail, !noindex(1.5)=pass
    expect(
      scoreCategory([
        [true, 2.0],
        [false, 1.0],
        [true, 1.5],
      ]),
    ).toBe(78)
  })
})

function makeAnalysis(over: Partial<PageAnalysis> = {}): PageAnalysis {
  return {
    title: 'Home',
    title_len: 4,
    meta_desc: '',
    meta_desc_len: 0,
    canonical: '',
    noindex: false,
    h1_count: 1,
    h1_texts: ['Home'],
    h2_count: 0,
    headings: {},
    heading_skip: false,
    imgs_total: 0,
    imgs_missing_alt: 0,
    og_title: false,
    og_desc: false,
    og_image: false,
    tw_card: false,
    viewport: false,
    schema_types: [],
    schema_valid: true,
    word_count: 0,
    fk_grade: null,
    has_cta: false,
    has_trust: false,
    has_phone: false,
    has_email: false,
    primary_phone: null,
    has_ga4: false,
    has_gtm: false,
    has_meta_px: false,
    has_linkedin: false,
    has_hotjar: false,
    has_clarity: false,
    mixed_content: false,
    mixed_content_urls: [],
    sec_headers: {},
    sec_header_count: 0,
    url_has_params: false,
    url_has_caps: false,
    buttons_missing_label: 0,
    inputs_missing_label: 0,
    has_skip_nav: false,
    local_biz_nap: false,
    local_biz_geo: false,
    local_biz_hours: false,
    has_map_embed: false,
    page_text_sample: '',
    content_length_bytes: 0,
    redirect_count: 0,
    ...over,
  }
}

function makeInput(analyzed: PageAnalysis[]): ComputeScoresInput {
  const pages: CrawledPage[] = analyzed.map((_, i) => ({
    url: `https://acme.example/${i}`,
    original_url: `https://acme.example/${i}`,
    status_code: 200,
    redirect_chain: [],
    redirect_count: 0,
    html: '',
    response_headers: {},
    ssl_error: false,
    content_length: 0,
  }))
  return {
    pages,
    analyzed,
    robots: { present: false, sitemaps: [] },
    sitemap: { found: false, url: null, is_index: false, child_sitemaps: [], count: 0, pages: 0, posts: 0, other: 0, page_entries: [] },
    ssl: { valid: true, expiry_days: 90, error: null },
    psiMobile: { score: null },
    psiDesktop: { score: null },
    llms: { present: false, url: null },
    errors: [],
    has404: false,
    googleIndexCount: null,
  }
}

describe('computeScores — Local SEO category', () => {
  it('scores a fully-local page at 100 and populates findings', () => {
    const homepage = makeAnalysis({
      schema_types: ['AccountingService'],
      local_biz_nap: true,
      local_biz_geo: true,
      local_biz_hours: true,
      has_map_embed: true,
      has_phone: true,
      primary_phone: '4105551212',
    })
    const { scores, findings } = computeScores(makeInput([homepage]))
    // All seven local checks pass → 100.
    expect(scores.local_seo).toBe(100)
    expect(findings.local_seo).toEqual({
      has_local_business: true,
      local_business_nap_complete: true,
      local_business_has_geo: true,
      local_business_has_hours: true,
      has_map_embed: true,
      nap_consistent: true,
      homepage_has_contact: true,
    })
    // AccountingService must also register as a local business in schema findings.
    expect(findings.schema.has_local_business).toBe(true)
  })

  it('scores a non-local page at 0', () => {
    const { scores, findings } = computeScores(makeInput([makeAnalysis()]))
    expect(scores.local_seo).toBe(0)
    expect(findings.local_seo.has_local_business).toBe(false)
  })

  it('gives partial credit for schema + contact without geo/hours/map', () => {
    const homepage = makeAnalysis({
      schema_types: ['LocalBusiness'],
      local_biz_nap: true,
      has_email: true,
    })
    const { scores } = computeScores(makeInput([homepage]))
    // Passing weight: hasLocalBiz 2.0 + nap 2.0 + homepageContact 1.5 = 5.5 of 9.5 → 58.
    expect(scores.local_seo).toBe(58)
  })

  it('passes NAP consistency when every page shows the same phone', () => {
    const a = makeAnalysis({ primary_phone: '4105551212' })
    const b = makeAnalysis({ primary_phone: '4105551212' })
    const { findings } = computeScores(makeInput([a, b]))
    expect(findings.local_seo.nap_consistent).toBe(true)
  })

  it('flags inconsistent NAP when pages show different phones', () => {
    const a = makeAnalysis({ primary_phone: '4105551212' })
    const b = makeAnalysis({ primary_phone: '4105559999' })
    const { findings } = computeScores(makeInput([a, b]))
    expect(findings.local_seo.nap_consistent).toBe(false)
  })
})

describe('computeOverall — parity with the stgcpas sample', () => {
  // Stored scores from raw-docs/site-audit/reference/audit-stgcpas-com-2026-04-20.json
  const sampleScores: CategoryScores = {
    technical: 55,
    performance: null, // PSI was unavailable at capture
    onpage_seo: 23,
    content: 47,
    indexability: 78,
    schema: 75,
    ai_llm: 64,
    ux: 92,
    analytics: 0,
    local_seo: null, // predates the local_seo category; excluded from the weighted average
  }

  it('reproduces overall_score 55 (performance excluded as null)', () => {
    expect(computeOverall(sampleScores)).toBe(55)
  })

  it('reproduces overall_grade F', () => {
    expect(getGrade(computeOverall(sampleScores))).toBe('F')
  })

  it('returns 0 when every category is null', () => {
    const allNull = Object.fromEntries(
      Object.keys(sampleScores).map((k) => [k, null]),
    ) as CategoryScores
    expect(computeOverall(allNull)).toBe(0)
  })
})
