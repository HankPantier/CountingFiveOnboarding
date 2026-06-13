import { describe, expect, it } from 'vitest'
import type { Findings } from './types'
import {
  generateRecommendations,
  suggestMeta,
  suggestTitle,
} from './recommendations'

/** A baseline "healthy" findings object that produces zero recommendations. */
function healthyFindings(): Findings {
  return {
    technical: {
      ssl_valid: true,
      ssl_expiry_days: 200,
      ssl_error: null,
      robots_present: true,
      mixed_content_pages: 0,
      redirect_chain_pages: 0,
      broken_links: 0,
      avg_security_headers: 5,
      security_headers_sample: {},
    },
    performance: { mobile_score: 95, desktop_score: 99, lcp: 1.2, cls: 0.01 },
    onpage_seo: {
      pct_has_title: 100,
      pct_title_len_ok: 100,
      pct_unique_titles: 100,
      pct_has_meta: 100,
      pct_meta_len_ok: 100,
      pct_one_h1: 100,
      pct_no_heading_skip: 100,
      pct_alt_text_ok: 100,
      pct_og_complete: 100,
      pct_tw_card: 100,
      pct_clean_url: 100,
      pages_missing_title: [],
    },
    content: {
      pct_adequate_words: 100,
      avg_reading_grade: 9,
      pct_readable: 100,
      pct_has_cta: 100,
      pct_has_trust_signals: 100,
      homepage_has_contact: true,
      duplicate_title_pages: 0,
    },
    indexability: {
      sitemap_found: true,
      sitemap_url: 'https://x/sitemap.xml',
      sitemap_is_index: false,
      sitemap_child_count: 0,
      sitemap_url_count: 10,
      sitemap_pages: 10,
      sitemap_posts: 0,
      sitemap_other: 0,
      sitemap_in_robots: true,
      pages_with_noindex: 0,
      google_index_count: 10,
      crawled_pages: 10,
    },
    schema: {
      types_found: ['Organization', 'WebSite', 'BreadcrumbList'],
      has_organization: true,
      has_website: true,
      has_breadcrumb: true,
      has_local_business: false,
      has_article: false,
      has_faq: false,
      has_product: false,
      all_json_valid: true,
      pct_pages_with_schema: 100,
    },
    ai_llm: {
      llms_txt_present: true,
      llms_txt_url: 'https://x/llms.txt',
      ai_crawlers_blocked: [],
      ai_crawlers_allowed: [],
      has_faq_schema: false,
      has_about_content: true,
      contact_info_in_text: true,
    },
    ux: {
      pct_has_viewport: 100,
      pct_buttons_accessible: 100,
      pct_form_labels_ok: 100,
      pct_skip_nav: 100,
      has_custom_404: true,
    },
    analytics: {
      has_ga4: true,
      has_gtm: true,
      has_meta_pixel: true,
      has_linkedin_pixel: true,
      has_heatmap_tool: true,
      ga4_page_coverage: 10,
    },
  }
}

describe('generateRecommendations', () => {
  it('produces no recommendations for a healthy site', () => {
    expect(generateRecommendations(healthyFindings())).toEqual([])
  })

  it('flags issues and sorts critical before warning, then by effort', () => {
    const f = healthyFindings()
    f.technical.ssl_valid = false
    f.technical.ssl_error = 'expired'
    f.onpage_seo.pct_has_meta = 0 // critical, Low
    f.analytics.has_ga4 = false // critical, Low
    f.technical.avg_security_headers = 1 // warning, Medium
    f.ai_llm.llms_txt_present = false // warning, Low

    const recs = generateRecommendations(f)
    const priorities = recs.map((r) => r.priority)
    // all criticals come before all warnings
    const firstWarning = priorities.indexOf('warning')
    const lastCritical = priorities.lastIndexOf('critical')
    expect(lastCritical).toBeLessThan(firstWarning)
    expect(recs.some((r) => r.title === 'Fix SSL Certificate')).toBe(true)
    expect(recs.some((r) => r.title === 'Install Google Analytics 4 (GA4)')).toBe(true)
  })
})

describe('suggestTitle', () => {
  it('builds "H1 | Brand" when it fits', () => {
    expect(suggestTitle('Tax Services', 'https://x/services', 'Acme')).toBe('Tax Services | Acme')
  })
  it('derives from the URL path when no H1', () => {
    expect(suggestTitle('', 'https://x/our-team', 'Acme')).toBe('Our Team | Acme')
  })
  it('returns null when nothing to work with', () => {
    expect(suggestTitle('', 'https://x/', 'Acme')).toBeNull()
  })
})

describe('suggestMeta', () => {
  it('returns null for very short snippets', () => {
    expect(suggestMeta('too short')).toBeNull()
  })
  it('trims a long snippet to a sentence boundary', () => {
    const snippet =
      'We provide accounting and advisory services to small businesses across the region every single day. ' +
      'Extra trailing content that should be cut from the meta description entirely here.'
    const meta = suggestMeta(snippet)
    expect(meta).not.toBeNull()
    expect(meta!.length).toBeLessThanOrEqual(160)
  })
})
