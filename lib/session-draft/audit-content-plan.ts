// Deterministically maps an audit's crawl + findings into the session's
// content-planning fields (current_sitemap / proposed_sitemap / content_gaps).
// These are the fields the content pipeline already plans from, so populating
// them makes an audit-seeded session arrive at the content Sitemap phase with
// the real page list, rewrite candidates, and redirects already in place.
// Pure / no AI / no DB.
import type { AuditResult } from '@/types/audit-result'
import type { SessionSchema } from '@/types/session-schema'

type CurrentSitemap = NonNullable<SessionSchema['current_sitemap']>
type ProposedSitemap = NonNullable<SessionSchema['proposed_sitemap']>
type ContentGaps = NonNullable<SessionSchema['content_gaps']>

export interface ContentPlanSummary {
  pagesFound: number
  rewriteCandidates: number
  redirects: number
}

export interface AuditContentPlan {
  current_sitemap: CurrentSitemap
  proposed_sitemap: ProposedSitemap
  content_gaps: ContentGaps
  summary: ContentPlanSummary
}

const THIN_WORDS = 300
const MAX_THIN_LISTED = 10

const normUrl = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase()

export function mapAuditToContentPlan(result: AuditResult): AuditContentPlan {
  const pages = result.page_analysis_summary ?? []
  const crawlErrors = result.raw?.crawl_errors ?? []
  const rawPages = result.raw?.pages ?? []
  const content = result.findings?.content

  // ── current_sitemap ───────────────────────────────────────────────────────
  // Every crawled page is kept by default. We deliberately do NOT auto-infer
  // 'consolidate' from shared <title> tags: a duplicate title ≠ a duplicate
  // page (poorly-optimized sites reuse one title across distinct pages — the
  // audit flags that separately). Merging is a human decision made during
  // onboarding / the content Sitemap phase.
  const current: CurrentSitemap = []
  const seenUrls = new Set<string>()

  for (const p of pages) {
    const key = normUrl(p.url)
    if (seenUrls.has(key)) continue
    seenUrls.add(key)
    current.push({
      url: p.url,
      title: p.title || p.url,
      action: 'keep',
      live: p.status_code === 200,
    })
  }

  // Broken pages + redirect-chain origins → a pre-filled redirect worklist.
  const addRedirect = (from: string, to: string) => {
    const key = normUrl(from)
    if (!from || seenUrls.has(key)) return
    seenUrls.add(key)
    current.push({ url: from, title: from, action: 'redirect', new_url: to, live: false })
  }
  for (const e of crawlErrors) addRedirect(e.url, '')
  for (const rp of rawPages) {
    if (rp.original_url && normUrl(rp.original_url) !== normUrl(rp.url)) {
      addRedirect(rp.original_url, rp.url)
    }
  }

  // ── proposed_sitemap ──────────────────────────────────────────────────────
  // The rebuild working set: every live page as an update (deduped by
  // normalized URL so trailing-slash variants don't double up). New strategic
  // pages are added by the admin during onboarding / the content Sitemap phase.
  const proposed: ProposedSitemap = []
  const seenProposed = new Set<string>()
  for (const p of pages) {
    if (p.status_code !== 200) continue
    const key = normUrl(p.url)
    if (seenProposed.has(key)) continue
    seenProposed.add(key)
    proposed.push({ url: p.url, title: p.title || p.url, status: 'update' })
  }

  // ── content_gaps ──────────────────────────────────────────────────────────
  const authorityGaps: string[] = []
  const thinSeen = new Set<string>()
  const thinPages = pages.filter((p) => {
    if (p.status_code !== 200 || p.word_count >= THIN_WORDS) return false
    const k = normUrl(p.url)
    if (thinSeen.has(k)) return false
    thinSeen.add(k)
    return true
  })
  for (const p of thinPages.slice(0, MAX_THIN_LISTED)) {
    authorityGaps.push(`${p.title || p.url} (${p.url}) — thin content, ${p.word_count} words`)
  }
  if (content && content.pct_adequate_words < 70) {
    authorityGaps.push(`Only ${content.pct_adequate_words}% of pages have 300+ words — expand thin pages.`)
  }

  const conversionGaps: string[] = []
  if (content) {
    if (content.pct_has_cta < 60) conversionGaps.push('Most pages lack a clear call to action.')
    if (content.pct_has_trust_signals < 30)
      conversionGaps.push('Few pages show trust signals (reviews, certifications, guarantees).')
    if (!content.homepage_has_contact)
      conversionGaps.push('Homepage is missing visible contact info (phone or email).')
  }

  const content_gaps: ContentGaps = {
    nicheGaps: [],
    authorityGaps,
    conversionGaps,
    teamExpertiseGaps: [],
  }

  return {
    current_sitemap: current,
    proposed_sitemap: proposed,
    content_gaps,
    summary: {
      pagesFound: proposed.length,
      rewriteCandidates: thinPages.length,
      redirects: current.filter((c) => c.action === 'redirect').length,
    },
  }
}
