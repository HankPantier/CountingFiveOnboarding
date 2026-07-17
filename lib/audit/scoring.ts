// Pure scoring math — ported 1:1 from audit.py (score_category, compute_scores,
// compute_overall, get_grade). These are the parity anchor: the numbers must
// match audit.py exactly. No network, no DB — fully unit-testable.
//
// Deviation from audit.py for purity: audit.py's compute_scores performs a live
// 404 HTTP probe inline. Here that probe is done by the orchestrator and its
// result passed in as `has404`, keeping this module side-effect free.
import { GRADE_SCALE, SCORING_WEIGHTS, SEC_HEADER_NAMES } from './constants'
import type {
  CategoryScores,
  CrawledPage,
  CrawlError,
  Findings,
  Grade,
  LlmsResult,
  PageAnalysis,
  PageSpeedResult,
  RobotsResult,
  SitemapInfo,
  SslResult,
} from './types'

/**
 * Python's round() uses round-half-to-even (banker's rounding); JS Math.round
 * rounds half up. Replicate Python exactly so scores match audit.py — e.g.
 * round(12.5) === 12, round(13.5) === 14.
 */
export function pyRound(value: number, digits = 0): number {
  const factor = 10 ** digits
  const scaled = value * factor
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let rounded: number
  if (Math.abs(diff - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1
  } else {
    rounded = Math.floor(scaled + 0.5)
  }
  return rounded / factor
}

/** audit.py get_grade — returns the letter grade for a 0–100 score. */
export function getGrade(score: number): Grade {
  for (const [threshold, grade] of GRADE_SCALE) {
    if (score >= threshold) return grade
  }
  return 'F'
}

/** audit.py score_category — weighted pass ratio → 0–100. */
export function scoreCategory(checks: Array<[boolean, number]>): number {
  const totalWeight = checks.reduce((s, [, w]) => s + w, 0)
  if (totalWeight === 0) return 100
  const passedWeight = checks.reduce((s, [p, w]) => s + (p ? w : 0), 0)
  return pyRound((passedWeight / totalWeight) * 100)
}

export interface ComputeScoresInput {
  pages: CrawledPage[]
  analyzed: PageAnalysis[]
  robots: RobotsResult
  sitemap: SitemapInfo
  ssl: SslResult
  psiMobile: PageSpeedResult
  psiDesktop: PageSpeedResult
  llms: LlmsResult
  errors: CrawlError[]
  /** Result of the live 404 probe (lifted out of scoring for purity). */
  has404: boolean
  /** Serper `site:` count; display-only — does not affect the score. */
  googleIndexCount?: number | null
}

const pct = (count: number, total: number) => count / total

/** audit.py compute_scores — all 9 categories. Returns scores + findings. */
export function computeScores(input: ComputeScoresInput): {
  scores: CategoryScores
  findings: Findings
} {
  const { pages, analyzed, robots, sitemap, ssl, psiMobile, psiDesktop, llms, errors } = input
  const n = Math.max(1, analyzed.length)

  // ─ 1. Technical Health ─────────────────────────────────────────────────
  const allSecCounts = analyzed.map((p) => p.sec_header_count)
  const avgSec = allSecCounts.reduce((s, v) => s + v, 0) / Math.max(1, allSecCounts.length)
  const mixedPages = analyzed.filter((p) => p.mixed_content).length
  const redirectChainPages = pages.filter((pg) => (pg.redirect_count ?? 0) > 1)
  const brokenPages = errors.length

  const mixedContentDetail: Array<{ page: string; resources: string[] }> = []
  pages.forEach((pg, i) => {
    const an = analyzed[i]
    if (an?.mixed_content && an.mixed_content_urls?.length) {
      mixedContentDetail.push({ page: pg.url ?? '', resources: an.mixed_content_urls.slice(0, 10) })
    }
  })

  const secHeadersSample = analyzed[0]?.sec_headers ?? {}
  const missingSecurityHeaders = SEC_HEADER_NAMES.filter((h) => !secHeadersSample[h])
  const sslOk = ssl.valid && !ssl.error

  const techChecks: Array<[boolean, number]> = [
    [sslOk, 2.0],
    [robots.present, 1.0],
    [mixedPages === 0, 1.5],
    [redirectChainPages.length === 0, 1.0],
    [brokenPages === 0, 1.5],
    [avgSec >= 3, 1.5],
    [avgSec === 5, 0.5],
  ]

  // ─ 2. Core Web Vitals ──────────────────────────────────────────────────
  let performanceScore: number | null
  let performanceFindings: Findings['performance']
  if (psiMobile.score !== null && psiMobile.score !== undefined) {
    const mobScore = psiMobile.score
    const deskScore =
      psiDesktop && psiDesktop.score !== null && psiDesktop.score !== undefined
        ? psiDesktop.score
        : mobScore
    performanceScore = Math.floor((mobScore + deskScore) / 2)
    performanceFindings = {
      mobile_score: mobScore,
      desktop_score: deskScore,
      lcp: psiMobile.lcp ?? null,
      lcp_pass: psiMobile.lcp_pass ?? false,
      cls: psiMobile.cls ?? null,
      cls_pass: psiMobile.cls_pass ?? false,
      fcp: psiMobile.fcp ?? null,
      fcp_pass: psiMobile.fcp_pass ?? false,
      ttfb: psiMobile.ttfb ?? null,
      inp: psiMobile.inp ?? null,
    }
  } else {
    performanceScore = null
    performanceFindings = { error: psiMobile.error ?? 'PSI unavailable' }
  }

  // ─ 3. On-Page SEO ──────────────────────────────────────────────────────
  const titledCount = analyzed.filter((p) => p.title).length
  const pctHasTitle = pct(titledCount, n)
  const pctTitleLenOk = pct(analyzed.filter((p) => p.title_len >= 40 && p.title_len <= 65).length, n)
  const uniqueTitles = new Set(analyzed.filter((p) => p.title).map((p) => p.title)).size
  const pctUniqueTitle = uniqueTitles / Math.max(1, titledCount)
  const pctHasMeta = pct(analyzed.filter((p) => p.meta_desc).length, n)
  const pctMetaLenOk = pct(
    analyzed.filter((p) => p.meta_desc_len >= 100 && p.meta_desc_len <= 165).length,
    n,
  )
  const pctOneH1 = pct(analyzed.filter((p) => p.h1_count === 1).length, n)
  const pctNoSkip = pct(analyzed.filter((p) => !p.heading_skip).length, n)
  const pctAltTextOk = pct(
    analyzed.filter((p) => p.imgs_missing_alt === 0 || p.imgs_total === 0).length,
    n,
  )
  const pctOg = pct(analyzed.filter((p) => p.og_title && p.og_desc && p.og_image).length, n)
  const pctTw = pct(analyzed.filter((p) => p.tw_card).length, n)
  const pctCleanUrl = pct(analyzed.filter((p) => !p.url_has_params && !p.url_has_caps).length, n)

  const seoChecks: Array<[boolean, number]> = [
    [pctHasTitle > 0.9, 2.0],
    [pctTitleLenOk > 0.7, 1.5],
    [pctUniqueTitle > 0.9, 1.5],
    [pctHasMeta > 0.8, 2.0],
    [pctMetaLenOk > 0.7, 1.0],
    [pctOneH1 > 0.85, 2.0],
    [pctNoSkip > 0.85, 1.0],
    [pctAltTextOk > 0.8, 1.5],
    [pctOg > 0.7, 1.5],
    [pctTw > 0.5, 0.5],
    [pctCleanUrl > 0.9, 1.0],
  ]

  // ─ 4. Content Quality ──────────────────────────────────────────────────
  const pctAdequateWords = pct(analyzed.filter((p) => p.word_count >= 300).length, n)
  const fkScores = analyzed.map((p) => p.fk_grade).filter((f): f is number => f !== null)
  const avgFk = fkScores.reduce((s, v) => s + v, 0) / Math.max(1, fkScores.length)
  const pctReadable = fkScores.filter((f) => f <= 12).length / Math.max(1, fkScores.length)
  const pctHasCta = pct(analyzed.filter((p) => p.has_cta).length, n)
  const pctHasTrust = pct(analyzed.filter((p) => p.has_trust).length, n)
  const homepageContact = analyzed.length ? analyzed[0].has_phone || analyzed[0].has_email : false

  const titleGroups = new Map<string, number>()
  for (const p of analyzed) {
    if (p.title) {
      const key = p.title.toLowerCase()
      titleGroups.set(key, (titleGroups.get(key) ?? 0) + 1)
    }
  }
  let dupPages = 0
  for (const count of titleGroups.values()) if (count > 1) dupPages += count - 1

  const contentChecks: Array<[boolean, number]> = [
    [pctAdequateWords > 0.7, 2.0],
    // Reading level intentionally excluded from scoring (audit.py parity).
    [dupPages === 0, 1.5],
    [pctHasCta > 0.6, 2.0],
    [pctHasTrust > 0.3, 1.0],
    [homepageContact, 1.5],
  ]

  // ─ 5. Indexability ─────────────────────────────────────────────────────
  const pctNoindex = pct(analyzed.filter((p) => p.noindex).length, n)
  const sitemapInRobots = !!(robots.sitemaps && robots.sitemaps.length)
  const noindexImportant = pctNoindex > 0.1
  // Only the first 3 checks are scored; the Google-index check is display-only.
  const indexChecks: Array<[boolean, number]> = [
    [sitemap.found, 2.0],
    [sitemapInRobots, 1.0],
    [!noindexImportant, 1.5],
  ]
  const googleIndexed: number | 'unverified' =
    input.googleIndexCount !== null && input.googleIndexCount !== undefined
      ? input.googleIndexCount
      : 'unverified'

  // ─ 6. Schema & Structured Data ─────────────────────────────────────────
  const allSchemaTypes = new Set<string>()
  for (const p of analyzed) for (const t of p.schema_types) allSchemaTypes.add(t)
  allSchemaTypes.delete('__invalid_json__')
  const has = (t: string) => allSchemaTypes.has(t)
  const hasOrg = has('Organization')
  const hasWebsite = has('WebSite')
  const hasBreadcrumb = has('BreadcrumbList')
  // Local-business detection mirrors analyze-page's LOCAL_BUSINESS_TYPES set:
  // service subtypes (esp. AccountingService, which our generator emits) do NOT
  // contain 'Business', so the explicit list matters alongside the substring rule.
  const LOCAL_BUSINESS_TYPES = [
    'LocalBusiness',
    'AccountingService',
    'ProfessionalService',
    'FinancialService',
    'LegalService',
    'Attorney',
    'Notary',
    'InsuranceAgency',
  ]
  const hasLocalBiz =
    LOCAL_BUSINESS_TYPES.some((t) => has(t)) || [...allSchemaTypes].some((t) => t.includes('Business'))
  const hasArticle = has('Article') || has('BlogPosting')
  const hasFaq = has('FAQPage')
  const hasProduct = has('Product')
  const validJson = analyzed.every((p) => p.schema_valid)
  const pctWithSchema = pct(analyzed.filter((p) => p.schema_types.length).length, n)

  const schemaChecks: Array<[boolean, number]> = [
    [hasOrg, 2.0],
    [hasWebsite, 1.5],
    [hasBreadcrumb, 1.0],
    [pctWithSchema > 0.5, 1.5],
    [validJson, 2.0],
  ]

  // ─ 7. AI / LLM Readiness ───────────────────────────────────────────────
  const hasLlmsTxt = llms.present
  const aiCrawlersNotBlocked = (robots.ai_blocked ?? []).length === 0
  const hasFaqContent = analyzed.some((p) => p.schema_types.includes('FAQPage'))
  const homepageText = analyzed.length ? analyzed[0].page_text_sample.toLowerCase() : ''
  const aboutKeywords = [
    'we are',
    'who we are',
    'our mission',
    'about us',
    'founded',
    'we help',
    'we specialize',
  ]
  const hasAboutContent = aboutKeywords.some((kw) => homepageText.includes(kw))
  const hasPhoneInText = analyzed.length ? analyzed[0].has_phone : false

  const aiChecks: Array<[boolean, number]> = [
    [hasLlmsTxt, 1.5],
    [aiCrawlersNotBlocked, 2.0],
    [hasFaqContent, 1.0],
    [hasAboutContent, 1.5],
    [hasPhoneInText, 1.0],
  ]

  // ─ 8. UX & Accessibility ───────────────────────────────────────────────
  const pctHasViewport = pct(analyzed.filter((p) => p.viewport).length, n)
  const pctNoMissingBtns = pct(analyzed.filter((p) => p.buttons_missing_label === 0).length, n)
  const pctFormLabelsOk = pct(analyzed.filter((p) => p.inputs_missing_label === 0).length, n)
  const pctSkipNav = pct(analyzed.filter((p) => p.has_skip_nav).length, n)
  const hasCustom404 = input.has404

  const uxChecks: Array<[boolean, number]> = [
    [pctHasViewport > 0.9, 2.0],
    [pctNoMissingBtns > 0.8, 1.5],
    [pctFormLabelsOk > 0.8, 1.5],
    [pctSkipNav > 0.3, 0.5],
    [hasCustom404, 1.0],
  ]

  // ─ 9. Analytics & Tracking ─────────────────────────────────────────────
  const anyGa4 = analyzed.some((p) => p.has_ga4)
  const anyGtm = analyzed.some((p) => p.has_gtm)
  const anyMetaPx = analyzed.some((p) => p.has_meta_px)
  const anyLinkedin = analyzed.some((p) => p.has_linkedin)
  const anyHotjar = analyzed.some((p) => p.has_hotjar || p.has_clarity)
  const ga4Pages = analyzed.filter((p) => p.has_ga4).length
  const ga4CoverageOk = ga4Pages >= Math.min(2, analyzed.length)

  const analyticsChecks: Array<[boolean, number]> = [
    [anyGa4, 3.0],
    [anyGtm, 2.0],
    [ga4CoverageOk, 1.5],
    [anyMetaPx, 1.0],
    [anyLinkedin, 0.5],
  ]

  // ─ 10. Local SEO ───────────────────────────────────────────────────────
  // Rewards local-business JSON-LD (LocalBusiness/AccountingService et al.) with
  // complete NAP, geo, hours, plus a map embed and reachable homepage contact.
  const anyLocalNap = analyzed.some((p) => p.local_biz_nap)
  const anyLocalGeo = analyzed.some((p) => p.local_biz_geo)
  const anyLocalHours = analyzed.some((p) => p.local_biz_hours)
  const anyMapEmbed = analyzed.some((p) => p.has_map_embed)

  // NAP consistency: every page that shows a phone shows the SAME one. A
  // single distinct number passes; zero (nothing to confirm) or ≥2 (conflicting
  // numbers hurt local ranking) fails.
  const distinctPhones = new Set(analyzed.map((p) => p.primary_phone).filter((x): x is string => !!x))
  const napConsistent = distinctPhones.size === 1

  const localChecks: Array<[boolean, number]> = [
    [hasLocalBiz, 2.0],
    [anyLocalNap, 2.0],
    [anyLocalGeo, 1.0],
    [anyLocalHours, 1.0],
    [anyMapEmbed, 1.0],
    [napConsistent, 1.0],
    [homepageContact, 1.5],
  ]

  const scores: CategoryScores = {
    technical: scoreCategory(techChecks),
    performance: performanceScore,
    onpage_seo: scoreCategory(seoChecks),
    content: scoreCategory(contentChecks),
    indexability: scoreCategory(indexChecks),
    schema: scoreCategory(schemaChecks),
    ai_llm: scoreCategory(aiChecks),
    ux: scoreCategory(uxChecks),
    analytics: scoreCategory(analyticsChecks),
    local_seo: scoreCategory(localChecks),
  }

  const findings: Findings = {
    technical: {
      ssl_valid: sslOk,
      ssl_expiry_days: ssl.expiry_days,
      ssl_error: ssl.error,
      robots_present: robots.present,
      mixed_content_pages: mixedPages,
      mixed_content_detail: mixedContentDetail,
      redirect_chain_pages: redirectChainPages.length,
      broken_links: brokenPages,
      avg_security_headers: pyRound(avgSec, 1),
      security_headers_sample: secHeadersSample,
      missing_security_headers: missingSecurityHeaders,
    },
    performance: performanceFindings,
    onpage_seo: {
      pct_has_title: pyRound(pctHasTitle * 100),
      pct_title_len_ok: pyRound(pctTitleLenOk * 100),
      pct_unique_titles: pyRound(pctUniqueTitle * 100),
      pct_has_meta: pyRound(pctHasMeta * 100),
      pct_meta_len_ok: pyRound(pctMetaLenOk * 100),
      pct_one_h1: pyRound(pctOneH1 * 100),
      pct_no_heading_skip: pyRound(pctNoSkip * 100),
      pct_alt_text_ok: pyRound(pctAltTextOk * 100),
      pct_og_complete: pyRound(pctOg * 100),
      pct_tw_card: pyRound(pctTw * 100),
      pct_clean_url: pyRound(pctCleanUrl * 100),
      pages_missing_title: analyzed
        .map((an, i) => (!an.title ? pages[i]?.url : null))
        .filter((u): u is string => !!u)
        .slice(0, 5),
    },
    content: {
      pct_adequate_words: pyRound(pctAdequateWords * 100),
      avg_reading_grade: pyRound(avgFk, 1),
      pct_readable: pyRound(pctReadable * 100),
      pct_has_cta: pyRound(pctHasCta * 100),
      pct_has_trust_signals: pyRound(pctHasTrust * 100),
      homepage_has_contact: homepageContact,
      duplicate_title_pages: dupPages,
    },
    indexability: {
      sitemap_found: sitemap.found,
      sitemap_url: sitemap.url,
      sitemap_is_index: sitemap.is_index ?? false,
      sitemap_child_count: (sitemap.child_sitemaps ?? []).length,
      sitemap_url_count: sitemap.count ?? 0,
      sitemap_pages: sitemap.pages ?? 0,
      sitemap_posts: sitemap.posts ?? 0,
      sitemap_other: sitemap.other ?? 0,
      sitemap_in_robots: sitemapInRobots,
      pages_with_noindex: pyRound(pctNoindex * 100),
      google_index_count: googleIndexed,
      crawled_pages: pages.length,
    },
    schema: {
      types_found: [...allSchemaTypes].sort(),
      has_organization: hasOrg,
      has_website: hasWebsite,
      has_breadcrumb: hasBreadcrumb,
      has_local_business: hasLocalBiz,
      has_article: hasArticle,
      has_faq: hasFaq,
      has_product: hasProduct,
      all_json_valid: validJson,
      pct_pages_with_schema: pyRound(pctWithSchema * 100),
    },
    ai_llm: {
      llms_txt_present: hasLlmsTxt,
      llms_txt_url: llms.url,
      ai_crawlers_blocked: robots.ai_blocked ?? [],
      ai_crawlers_allowed: robots.ai_allowed ?? [],
      has_faq_schema: hasFaqContent,
      has_about_content: hasAboutContent,
      contact_info_in_text: hasPhoneInText,
    },
    ux: {
      pct_has_viewport: pyRound(pctHasViewport * 100),
      pct_buttons_accessible: pyRound(pctNoMissingBtns * 100),
      pct_form_labels_ok: pyRound(pctFormLabelsOk * 100),
      pct_skip_nav: pyRound(pctSkipNav * 100),
      has_custom_404: hasCustom404,
    },
    analytics: {
      has_ga4: anyGa4,
      has_gtm: anyGtm,
      has_meta_pixel: anyMetaPx,
      has_linkedin_pixel: anyLinkedin,
      has_heatmap_tool: anyHotjar,
      ga4_page_coverage: ga4Pages,
    },
    local_seo: {
      has_local_business: hasLocalBiz,
      local_business_nap_complete: anyLocalNap,
      local_business_has_geo: anyLocalGeo,
      local_business_has_hours: anyLocalHours,
      nap_consistent: napConsistent,
      has_map_embed: anyMapEmbed,
      homepage_has_contact: homepageContact,
    },
  }

  return { scores, findings }
}

/** audit.py compute_overall — weighted average over measured categories. */
export function computeOverall(scores: CategoryScores): number {
  let total = 0
  let totalWeight = 0
  for (const cat of Object.keys(SCORING_WEIGHTS) as Array<keyof typeof SCORING_WEIGHTS>) {
    const s = scores[cat]
    if (s !== null && s !== undefined) {
      total += s * SCORING_WEIGHTS[cat]
      totalWeight += SCORING_WEIGHTS[cat]
    }
  }
  if (totalWeight === 0) return 0
  return pyRound(total / totalWeight)
}
