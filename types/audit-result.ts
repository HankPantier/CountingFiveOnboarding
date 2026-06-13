// Type contract for the site-audit engine and its persisted result.
//
// Ported from the shapes that the reference `audit.py` produces (see
// raw-docs/site-audit/reference/audit.py and the sample
// audit-stgcpas-com-2026-04-20.json). The sample JSON predates the current
// audit.py in a couple of `findings` fields, so fields the current code emits
// but the sample lacks are marked optional.
//
// `AuditResult` is the full structured value stored in `audit_runs.result`
// (JSONB). The report is always re-rendered from this JSON — never stored as
// pre-baked HTML. Unlike audit.py, we also persist the raw scoring inputs
// (`raw`) so scoring can be re-run for regression tests.

export type AuditStage =
  | 'queued'
  | 'crawling'
  | 'analyzing'
  | 'scoring'
  | 'rendering'
  | 'complete'
  | 'error'

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export type CategoryKey =
  | 'performance'
  | 'technical'
  | 'onpage_seo'
  | 'ux'
  | 'content'
  | 'indexability'
  | 'schema'
  | 'ai_llm'
  | 'analytics'

/** Per-category score 0–100 (null when the category could not be measured). */
export type CategoryScores = Record<CategoryKey, number | null>

/** Score + letter grade per category, stored in `audit_runs.category_scores`. */
export interface CategoryScore {
  score: number | null
  grade: Grade | null
}
export type CategoryScoreMap = Record<CategoryKey, CategoryScore>

// ── Per-category findings ──────────────────────────────────────────────────

export interface TechnicalFindings {
  ssl_valid: boolean
  ssl_expiry_days: number | null
  ssl_error: string | null
  robots_present: boolean
  mixed_content_pages: number
  mixed_content_detail?: Array<{ page: string; resources: string[] }>
  redirect_chain_pages: number
  broken_links: number
  avg_security_headers: number
  security_headers_sample: Record<string, boolean>
  missing_security_headers?: string[]
}

export interface PerformanceFindings {
  error?: string
  mobile_score?: number
  desktop_score?: number
  lcp?: number | null
  lcp_pass?: boolean
  cls?: number | null
  cls_pass?: boolean
  fcp?: number | null
  fcp_pass?: boolean
  ttfb?: number | null
  inp?: number | null
}

export interface OnpageSeoFindings {
  pct_has_title: number
  pct_title_len_ok: number
  pct_unique_titles: number
  pct_has_meta: number
  pct_meta_len_ok: number
  pct_one_h1: number
  pct_no_heading_skip: number
  pct_alt_text_ok: number
  pct_og_complete: number
  pct_tw_card: number
  pct_clean_url: number
  pages_missing_title: string[]
}

export interface ContentFindings {
  pct_adequate_words: number
  avg_reading_grade: number
  pct_readable: number
  pct_has_cta: number
  pct_has_trust_signals: number
  homepage_has_contact: boolean
  duplicate_title_pages: number
}

export interface IndexabilityFindings {
  sitemap_found: boolean
  sitemap_url: string | null
  sitemap_is_index: boolean
  sitemap_child_count: number
  sitemap_url_count: number
  sitemap_pages: number
  sitemap_posts: number
  sitemap_other: number
  sitemap_in_robots: boolean
  pages_with_noindex: number
  /** Integer count from the Serper `site:` query, or 'unverified' when no key. */
  google_index_count: number | 'unverified'
  crawled_pages: number
}

export interface SchemaFindings {
  types_found: string[]
  has_organization: boolean
  has_website: boolean
  has_breadcrumb: boolean
  has_local_business: boolean
  has_article: boolean
  has_faq: boolean
  has_product: boolean
  all_json_valid: boolean
  pct_pages_with_schema: number
}

export interface AiLlmFindings {
  llms_txt_present: boolean
  llms_txt_url: string | null
  ai_crawlers_blocked: string[]
  ai_crawlers_allowed: string[]
  has_faq_schema: boolean
  has_about_content: boolean
  contact_info_in_text: boolean
}

export interface UxFindings {
  pct_has_viewport: number
  pct_buttons_accessible: number
  pct_form_labels_ok: number
  pct_skip_nav: number
  has_custom_404: boolean
}

export interface AnalyticsFindings {
  has_ga4: boolean
  has_gtm: boolean
  has_meta_pixel: boolean
  has_linkedin_pixel: boolean
  has_heatmap_tool: boolean
  ga4_page_coverage: number
}

export interface Findings {
  technical: TechnicalFindings
  performance: PerformanceFindings
  onpage_seo: OnpageSeoFindings
  content: ContentFindings
  indexability: IndexabilityFindings
  schema: SchemaFindings
  ai_llm: AiLlmFindings
  ux: UxFindings
  analytics: AnalyticsFindings
}

// ── Recommendations ────────────────────────────────────────────────────────

export type RecommendationPriority = 'critical' | 'warning'
export type RecommendationEffort = 'Low' | 'Medium' | 'High'

export interface Recommendation {
  priority: RecommendationPriority
  category: string
  title: string
  detail: string
  effort: RecommendationEffort
  impact?: string
}

// ── Raw crawl + analysis inputs (persisted for regression testing) ──────────

export interface RedirectHop {
  url: string
  status: number
}

export interface CrawledPage {
  /** Final URL after redirects. */
  url: string
  /** URL as discovered/queued, before redirects. */
  original_url: string
  status_code: number
  redirect_chain: RedirectHop[]
  redirect_count: number
  html: string
  response_headers: Record<string, string>
  ssl_error: boolean
  content_length: number
}

export interface CrawlError {
  url: string
  status?: number
  error: string
}

/** Rich per-page analysis (audit.py `analyze_page` return). Feeds scoring. */
export interface PageAnalysis {
  title: string
  title_len: number
  meta_desc: string
  meta_desc_len: number
  /** Canonical href, or '' when absent (audit.py stores ''). */
  canonical: string
  noindex: boolean
  h1_count: number
  h1_texts: string[]
  h2_count: number
  headings: Record<string, string[]>
  heading_skip: boolean
  imgs_total: number
  imgs_missing_alt: number
  og_title: boolean
  og_desc: boolean
  og_image: boolean
  tw_card: boolean
  tw_title: boolean
  tw_image: boolean
  viewport: boolean
  schema_types: string[]
  schema_valid: boolean
  word_count: number
  fk_grade: number | null
  has_cta: boolean
  has_trust: boolean
  has_phone: boolean
  has_email: boolean
  has_ga4: boolean
  has_gtm: boolean
  has_meta_px: boolean
  has_linkedin: boolean
  has_hotjar: boolean
  has_clarity: boolean
  mixed_content: boolean
  mixed_content_urls: string[]
  sec_headers: Record<string, boolean>
  sec_header_count: number
  lazy_anchors: number
  url_has_params: boolean
  url_has_caps: boolean
  buttons_missing_label: number
  inputs_missing_label: number
  has_skip_nav: boolean
  page_text_sample: string
  content_length_bytes: number
  redirect_count: number
}

/** Derived per-page summary for the report's page inventory. */
export interface PageSummary {
  url: string
  status_code: number
  title: string
  title_ok: boolean
  title_len: number
  meta_desc: string
  meta_ok: boolean
  meta_len: number
  h1_count: number
  h1_text: string
  schema_types: string[]
  word_count: number
  og_complete: boolean
  has_ga4: boolean
  issues: string[]
  content_snippet: string
  /** Suggested replacements for thin/missing metadata (display aids). */
  suggested_title: string | null
  suggested_meta: string | null
}

export interface SitemapEntry {
  url: string
  lastmod: string
  type: string
}

export interface SitemapInfo {
  found: boolean
  url: string | null
  is_index: boolean
  child_sitemaps: string[]
  count: number
  pages: number
  posts: number
  other: number
  page_entries: SitemapEntry[]
}

export interface RobotsResult {
  present: boolean
  sitemaps: string[]
  content?: string
  ai_blocked?: string[]
  ai_allowed?: string[]
}

export interface SslResult {
  valid: boolean
  expiry_days: number | null
  error: string | null
}

export interface PageSpeedResult {
  score: number | null
  lcp?: number | null
  lcp_pass?: boolean
  cls?: number | null
  cls_pass?: boolean
  fcp?: number | null
  fcp_pass?: boolean
  ttfb?: number | null
  inp?: number | null
  error?: string
}

export interface LlmsResult {
  present: boolean
  url: string | null
  content?: string
}

/** Result of the Serper `site:` index check. */
export interface IndexCheckResult {
  google_index_count: number | 'unverified'
  google_indexed_urls: string[]
}

/** Raw scoring inputs — our addition (audit.py discarded these). */
export interface AuditRawInputs {
  pages: CrawledPage[]
  analyzed: PageAnalysis[]
  psi_mobile: PageSpeedResult
  psi_desktop: PageSpeedResult
  robots: RobotsResult
  ssl: SslResult
  llms: LlmsResult
  crawl_errors: CrawlError[]
}

// ── Top-level result ───────────────────────────────────────────────────────

/** Full structured value stored in `audit_runs.result` (JSONB). */
export interface AuditResult {
  version: string
  domain: string
  site_name: string
  url: string
  audit_date: string
  max_pages: number
  pages_crawled: number
  crawl_errors_count: number
  overall_score: number
  overall_grade: Grade
  scores: CategoryScores
  category_scores: CategoryScoreMap
  findings: Findings
  recommendations: Recommendation[]
  page_analysis_summary: PageSummary[]
  google_indexed_urls: string[]
  sitemap: SitemapInfo
  /** Persisted for re-scoring/regression. Optional so older rows stay valid. */
  raw?: AuditRawInputs
}

/** Input to `runAudit()`. The engine is pure with respect to the DB. */
export interface RunAuditInput {
  url: string
  siteName?: string
  maxPages?: number
  focusSegments?: string[]
  onProgress?: (stage: AuditStage, detail: string, pagesCrawled?: number) => Promise<void>
}
