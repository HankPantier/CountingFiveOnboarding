// Priority-ranked recommendations + per-page issue/summary builders + SEO
// suggestion helpers. Ported from audit.py generate_recommendations,
// _page_issues, _suggest_title, _suggest_meta.
//
// Deviation from audit.py (intentional, display-only): audit.py's _page_issues
// reads `og_complete`, a key that never exists on the analyzed dict, so it
// flags "Missing OG tags" on every page and stores og_complete as always-false.
// We compute og_complete = og_title && og_desc && og_image (the evident intent,
// and how scoring already measures OG completeness). No score is affected.
import { SOCIAL_PLATFORM_LABELS } from './intelligence-format'
import type {
  CrawledPage,
  Findings,
  PageAnalysis,
  PageSummary,
  Recommendation,
  RecommendationEffort,
  RecommendationPriority,
  SocialPresenceReport,
} from './types'

// Shared comparator: critical first, then warning, then by effort (Low → High).
// Stable. Exported so the audit can re-sort after merging the social recs
// (generated post-intelligence) into the findings-based list.
const PRIORITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }
const EFFORT_ORDER: Record<string, number> = { Low: 0, Medium: 1, High: 2 }
export function sortRecommendations(recs: Recommendation[]): Recommendation[] {
  return recs.sort((a, b) => {
    const p = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
    if (p !== 0) return p
    return (EFFORT_ORDER[a.effort] ?? 1) - (EFFORT_ORDER[b.effort] ?? 1)
  })
}

export function generateRecommendations(findings: Findings): Recommendation[] {
  const recs: Recommendation[] = []
  const add = (
    priority: RecommendationPriority,
    category: string,
    title: string,
    detail: string,
    effort: RecommendationEffort = 'Medium',
  ) => recs.push({ priority, category, title, detail, effort })

  const f = findings

  // Technical
  if (!f.technical.ssl_valid)
    add(
      'critical',
      'Technical',
      'Fix SSL Certificate',
      `SSL error: ${f.technical.ssl_error ?? 'Invalid certificate'}. HTTPS is required for rankings and trust.`,
      'Low',
    )
  if (f.technical.mixed_content_pages > 0)
    add(
      'warning',
      'Technical',
      'Fix Mixed Content',
      `${f.technical.mixed_content_pages} page(s) load HTTP resources on HTTPS. Browsers will block these.`,
      'Medium',
    )
  if (!f.technical.robots_present)
    add(
      'warning',
      'Technical',
      'Add robots.txt',
      'No robots.txt found. Add one to guide crawlers and reference your sitemap.',
      'Low',
    )
  if (f.technical.avg_security_headers < 3)
    add(
      'warning',
      'Technical',
      'Add Security Headers',
      `Only ${f.technical.avg_security_headers.toFixed(0)}/5 security headers set. Add Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options at minimum.`,
      'Medium',
    )
  if (f.technical.broken_links > 0)
    add(
      'critical',
      'Technical',
      'Fix Broken Pages',
      `${f.technical.broken_links} URL(s) returning errors were found during crawl.`,
      'Medium',
    )

  // Performance
  const perf = f.performance
  if (perf.mobile_score !== undefined && perf.mobile_score < 50)
    add(
      'critical',
      'Performance',
      'Improve Mobile PageSpeed Score',
      `Mobile score is ${perf.mobile_score}/100. Google uses mobile-first indexing — a score below 50 directly hurts rankings.`,
      'High',
    )
  else if (perf.mobile_score !== undefined && perf.mobile_score < 75)
    add(
      'warning',
      'Performance',
      'Improve Mobile PageSpeed Score',
      `Mobile score is ${perf.mobile_score}/100. Aim for 75+.`,
      'High',
    )
  if (perf.lcp && perf.lcp > 4.0)
    add(
      'critical',
      'Performance',
      'Fix Slow LCP (Largest Contentful Paint)',
      `LCP is ${perf.lcp}s. Target is under 2.5s. Check image sizes and server response time.`,
      'High',
    )
  if (perf.cls && perf.cls > 0.25)
    add(
      'warning',
      'Performance',
      'Reduce Layout Shift (CLS)',
      `CLS is ${perf.cls} (target: < 0.1). Set explicit width/height on images and embeds.`,
      'Medium',
    )

  // On-Page SEO
  const seo = f.onpage_seo
  if (seo.pct_has_meta < 80)
    add(
      'critical',
      'On-Page SEO',
      'Add Missing Meta Descriptions',
      `Only ${seo.pct_has_meta}% of pages have meta descriptions. These appear in search results and affect click-through rate.`,
      'Low',
    )
  if (seo.pct_one_h1 < 85)
    add(
      'critical',
      'On-Page SEO',
      'Fix H1 Tag Issues',
      `Only ${seo.pct_one_h1}% of pages have exactly one H1. Every page needs exactly one H1 — it's the primary on-page signal.`,
      'Low',
    )
  if (seo.pct_has_title < 95)
    add(
      'critical',
      'On-Page SEO',
      'Add Missing Title Tags',
      `${100 - seo.pct_has_title}% of pages are missing title tags.`,
      'Low',
    )
  if (seo.pct_og_complete < 70)
    add(
      'warning',
      'On-Page SEO',
      'Add Open Graph Tags',
      `Only ${seo.pct_og_complete}% of pages have complete Open Graph tags. These control how the site looks when shared on social media.`,
      'Low',
    )
  if (seo.pct_alt_text_ok < 80)
    add(
      'warning',
      'On-Page SEO',
      'Fix Missing Image Alt Text',
      `Only ${seo.pct_alt_text_ok}% of pages have all images tagged with alt text. This hurts accessibility and image SEO.`,
      'Low',
    )

  // Content
  const cont = f.content
  if (cont.pct_adequate_words < 70)
    add(
      'warning',
      'Content',
      'Expand Thin Content',
      `Only ${cont.pct_adequate_words}% of pages have 300+ words. Thin content ranks poorly and doesn't convert.`,
      'High',
    )
  if (!cont.homepage_has_contact)
    add(
      'critical',
      'Content',
      'Add Contact Info to Homepage',
      'No phone number or email address found on the homepage. This reduces trust and conversions.',
      'Low',
    )
  if (cont.pct_has_cta < 60)
    add(
      'warning',
      'Content',
      'Add Calls to Action',
      `Only ${cont.pct_has_cta}% of pages have a clear CTA. Every page should guide users to a next step.`,
      'Medium',
    )
  if (cont.duplicate_title_pages > 0)
    add(
      'warning',
      'Content',
      'Fix Duplicate Page Titles',
      `${cont.duplicate_title_pages} pages share a title with another page. Unique titles are required for SEO.`,
      'Low',
    )

  // Indexability
  const idx = f.indexability
  if (!idx.sitemap_found)
    add(
      'critical',
      'Indexability',
      'Create and Submit XML Sitemap',
      'No sitemap.xml found. Submit one to Google Search Console to ensure all pages are indexed.',
      'Low',
    )
  if (!idx.sitemap_in_robots)
    add(
      'warning',
      'Indexability',
      'Reference Sitemap in robots.txt',
      "Add 'Sitemap: https://domain.com/sitemap.xml' to robots.txt so all crawlers find it.",
      'Low',
    )

  // Schema
  const sch = f.schema
  if (!sch.has_organization)
    add(
      'critical',
      'Schema',
      'Add Organization Schema',
      'No Organization schema found. This is the baseline schema every business site needs — it tells Google who you are.',
      'Low',
    )
  if (!sch.has_website)
    add(
      'warning',
      'Schema',
      'Add WebSite Schema',
      'Add WebSite schema with a SearchAction to enable sitelinks search in Google.',
      'Low',
    )
  if (!sch.has_breadcrumb)
    add(
      'warning',
      'Schema',
      'Add BreadcrumbList Schema',
      'Breadcrumb schema on interior pages enables richer search result listings.',
      'Low',
    )
  if (!sch.all_json_valid)
    add(
      'critical',
      'Schema',
      'Fix Malformed JSON-LD',
      'Some schema blocks contain invalid JSON. These are silently ignored by Google — fix them with a JSON validator.',
      'Low',
    )

  // AI / LLM
  const ai = f.ai_llm
  if (!ai.llms_txt_present)
    add(
      'warning',
      'AI / LLM',
      'Add llms.txt File',
      'Create /llms.txt to help AI systems understand your site. This is the emerging standard for AI-readable site context.',
      'Low',
    )
  if (ai.ai_crawlers_blocked.length)
    add(
      'warning',
      'AI / LLM',
      'Review AI Crawler Blocks',
      `These AI crawlers are blocked in robots.txt: ${ai.ai_crawlers_blocked.join(', ')}. Consider whether blocking AI indexing is intentional.`,
      'Low',
    )

  // UX
  const ux = f.ux
  if (!ux.has_custom_404)
    add(
      'warning',
      'UX',
      'Create a Custom 404 Page',
      'The 404 page appears to be missing or minimal. A helpful 404 page with navigation reduces bounce rate.',
      'Low',
    )
  if (ux.pct_has_viewport < 90)
    add(
      'critical',
      'UX',
      'Add Viewport Meta Tag',
      `Only ${ux.pct_has_viewport}% of pages have a viewport meta tag. Without it, mobile browsers can't render the page correctly.`,
      'Low',
    )

  // Analytics
  const anal = f.analytics
  if (!anal.has_ga4)
    add(
      'critical',
      'Analytics',
      'Install Google Analytics 4 (GA4)',
      'No GA4 tracking detected. Without it, there is no data on who visits the site, where they come from, or what they do.',
      'Low',
    )
  if (anal.has_ga4 && !anal.has_gtm)
    add(
      'warning',
      'Analytics',
      'Install Google Tag Manager',
      'GA4 is present but GTM is not. GTM makes it easier to manage and add tags without developer involvement.',
      'Low',
    )
  if (!anal.has_meta_pixel)
    add(
      'warning',
      'Analytics',
      'Install Meta Pixel',
      'No Facebook/Meta Pixel detected. Required for retargeting ads and tracking conversions from Meta campaigns.',
      'Low',
    )

  return sortRecommendations(recs)
}

// Social & local presence recommendations, generated from the intelligence
// layer's SocialPresenceReport (not `findings`) after the audit's off-site pass.
// Kept separate from generateRecommendations so its findings-based signature and
// tests stay stable; the audit merges + re-sorts both lists.
export function generateSocialRecommendations(report: SocialPresenceReport): Recommendation[] {
  const recs: Recommendation[] = []
  const add = (
    priority: RecommendationPriority,
    title: string,
    detail: string,
    effort: RecommendationEffort = 'Medium',
  ) => recs.push({ priority, category: 'Local & Social', title, detail, effort })

  const gbp = report.profiles.find((p) => p.platform === 'google_business')
  const linkedin = report.profiles.find((p) => p.platform === 'linkedin')

  // Google Business Profile
  if (!report.hasGbp) {
    add(
      'critical',
      'Claim & Optimize Your Google Business Profile',
      'No Google Business Profile was found. Claiming and completing one is the single highest-impact move for local search and map-pack visibility.',
      'Low',
    )
  } else if (gbp) {
    const m = gbp.metrics
    if (typeof m.reviewCount === 'number' && m.reviewCount < 10) {
      add(
        'warning',
        'Build Google Reviews',
        `Only ${m.reviewCount} Google review${m.reviewCount === 1 ? '' : 's'} found. Reviews are a top local ranking factor and a trust signal — set up a steady process to earn new ones.`,
        'Medium',
      )
    }
    if (typeof m.rating === 'number' && m.rating < 4.0) {
      add(
        'warning',
        'Address Google Review Sentiment',
        `Your Google rating is ${m.rating.toFixed(1)}. Below 4.0 suppresses clicks — address the recurring concerns behind the reviews and invite satisfied clients to weigh in.`,
        'High',
      )
    }
    if (m.hoursListed === false || (m.categories && m.categories.length === 0)) {
      add(
        'warning',
        'Complete Your Google Business Profile Details',
        'Business hours and/or categories are missing from the listing. A complete profile ranks better and converts more searchers.',
        'Low',
      )
    }
  }

  // LinkedIn (required)
  if (!report.hasLinkedIn) {
    add(
      'warning',
      'Establish a LinkedIn Company Page',
      'No LinkedIn company page was found. A company page builds B2B credibility and is often the first result prospects check.',
      'Medium',
    )
  } else if (linkedin) {
    if (linkedin.metrics.pageType === 'personal') {
      add(
        'warning',
        'Create a LinkedIn Company Page',
        'Only a personal LinkedIn profile was found. A dedicated company page centralizes the firm’s brand and lets clients follow it.',
        'Medium',
      )
    }
    if (linkedin.status === 'dormant') {
      add(
        'warning',
        'Reactivate LinkedIn Posting',
        'Your LinkedIn presence looks dormant. A consistent posting cadence keeps the firm visible to referral sources and prospects.',
        'Low',
      )
    }
  }

  // Bonus channels: flag dormant ones so they’re revived or removed.
  for (const p of report.profiles) {
    if (p.platform === 'google_business' || p.platform === 'linkedin') continue
    if (p.status === 'dormant') {
      const label = SOCIAL_PLATFORM_LABELS[p.platform] ?? p.platform
      add(
        'warning',
        `Refresh Your Dormant ${label} Profile`,
        `Your ${label} profile appears inactive. Either revive it with a posting plan or remove the link so prospects don’t land on a stale channel.`,
        'Low',
      )
    }
  }

  return sortRecommendations(recs)
}

/** audit.py _page_issues — short issue strings for one page. `ogComplete` is
 * computed by the caller (see deviation note at top of file). */
export function pageIssues(an: PageAnalysis, ogComplete: boolean): string[] {
  const issues: string[] = []
  const title = an.title ?? ''
  const meta = an.meta_desc ?? ''
  const h1s = an.h1_texts ?? []
  const words = an.word_count ?? 0

  if (!title) issues.push('No title tag')
  else if (title.length < 30) issues.push(`Title too short (${title.length} chars)`)
  else if (title.length > 65) issues.push(`Title too long (${title.length} chars)`)

  if (!meta) issues.push('No meta description')
  else if (meta.length < 100) issues.push(`Meta description too short (${meta.length} chars)`)
  else if (meta.length > 165) issues.push(`Meta description too long (${meta.length} chars)`)

  if (!h1s.length) issues.push('No H1 tag')
  else if (h1s.length > 1) issues.push(`Multiple H1s (${h1s.length})`)

  if (!an.schema_types.length) issues.push('No schema markup')
  if (words < 300) issues.push(`Thin content (${words} words)`)
  if (!ogComplete) issues.push('Missing OG tags')
  if (!an.has_ga4) issues.push('No GA4 tracking')

  return issues
}

function titleCaseWords(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** audit.py _suggest_title — "H1 | Brand", trimmed to ≤60 chars. */
export function suggestTitle(
  h1Text: string,
  url: string,
  siteName: string,
): string | null {
  const brand = siteName || 'Your Brand'
  let h1 = (h1Text || '').trim()
  let path = ''
  try {
    path = new URL(url).pathname.replace(/^\/+|\/+$/g, '')
  } catch {
    path = ''
  }
  if (!h1 && path) {
    const parts = path.split('/')
    h1 = parts.length ? titleCaseWords(parts[parts.length - 1].replace(/-/g, ' ')) : ''
  }
  if (!h1) return null

  const sep = ' | '
  const full = `${h1}${sep}${brand}`
  if (full.length <= 60) return full

  const maxH1 = 60 - sep.length - brand.length
  if (maxH1 >= 15) {
    let trimmed = h1.slice(0, maxH1).replace(/\s+$/, '')
    const lastSpace = trimmed.lastIndexOf(' ')
    if (lastSpace > 10) trimmed = trimmed.slice(0, lastSpace)
    return `${trimmed}${sep}${brand}`
  }
  return h1.length > 60 ? `${h1.slice(0, 57).replace(/\s+$/, '')}…` : h1
}

/** audit.py _suggest_meta — clean 140–155 char excerpt from the snippet. */
export function suggestMeta(snippet: string): string | null {
  const s = (snippet || '').trim()
  if (!s || s.length < 40) return null

  const target = s.slice(0, 160)
  for (const endChar of ['. ', '! ', '? ']) {
    const region = target.slice(0, 155)
    const idx = region.lastIndexOf(endChar)
    if (idx >= 80) return target.slice(0, idx + 1).trim()
  }
  if (s.length > 155) {
    const cut = s.slice(0, 152)
    const lastSpace = cut.lastIndexOf(' ')
    if (lastSpace > 80) return `${cut.slice(0, lastSpace).trim()}…`
  }
  return s.slice(0, 155).trim()
}

/** Build the derived per-page summary (audit.py page_analysis_summary entry). */
export function buildPageSummary(page: CrawledPage, an: PageAnalysis, siteName: string): PageSummary {
  const rawSnippet = an.page_text_sample ?? ''
  const h1ForSnippet = (an.h1_texts[0] ?? '').trim()
  let cleanSnippet = ''
  if (h1ForSnippet && rawSnippet.includes(h1ForSnippet)) {
    let postH1 = rawSnippet.slice(rawSnippet.indexOf(h1ForSnippet) + h1ForSnippet.length)
    postH1 = postH1.replace(/^[\s.,—|\-]+/, '')
    cleanSnippet = postH1
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(' ')
      .slice(0, 600)
  }
  if (!cleanSnippet) {
    const fallback = rawSnippet.slice(150)
    cleanSnippet = fallback
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(' ')
      .slice(0, 600)
  }

  const ogComplete = an.og_title && an.og_desc && an.og_image
  const h1Text = (an.h1_texts[0] ?? '').slice(0, 80)

  return {
    url: page.url,
    status_code: page.status_code ?? 200,
    title: an.title ?? '',
    title_ok: !!an.title,
    title_len: (an.title ?? '').length,
    meta_desc: an.meta_desc ?? '',
    meta_ok: !!an.meta_desc,
    meta_len: (an.meta_desc ?? '').length,
    h1_count: an.h1_texts.length,
    h1_text: h1Text,
    schema_types: an.schema_types,
    word_count: an.word_count ?? 0,
    og_complete: ogComplete,
    has_ga4: an.has_ga4,
    issues: pageIssues(an, ogComplete),
    content_snippet: cleanSnippet,
    suggested_title: !an.title || an.title.length < 30 || an.title.length > 65
      ? suggestTitle(h1Text, page.url, siteName)
      : null,
    suggested_meta: !an.meta_desc || an.meta_desc.length < 100
      ? suggestMeta(cleanSnippet)
      : null,
  }
}
