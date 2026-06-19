// Pure presentation model that re-groups the engine's scored output into the
// eight client-friendly dashboard cards used by the shareable report (matching
// the supplied design target). The scoring engine, stored `category_scores`
// (0–100), and intelligence scores (0–10) are NOT changed — this only derives a
// display grouping. Shared by the standalone HTML export (lib/audit/html-report.ts)
// and the in-app React report (components/admin/audit/AuditReport.tsx).
import type { AuditResult, CategoryKey } from '@/types/audit-result'
import { SECTION_LABELS } from './intelligence-format'

export type BucketKind = 'intel' | 'composite' | 'tech_stack'

export interface DashboardBucket {
  /** Stable id — intel section id, composite id, or 'tech_stack'. */
  key: string
  label: string
  kind: BucketKind
  /** 0–100 (intel sections normalized ×10); null when unmeasured. */
  score: number | null
  /** Deterministic categories whose findings render under this card (composite only). */
  members: CategoryKey[]
}

/** Composite cards and the categories (with weights) that feed their score.
 * Weights only matter relative to each other; null members are dropped and the
 * remaining weights renormalize. Every CategoryKey appears in exactly one card
 * so no findings are lost. */
const COMPOSITES: Record<string, { label: string; members: ReadonlyArray<readonly [CategoryKey, number]> }> = {
  seo_aio_geo: {
    label: 'SEO / AIO / GEO Health',
    members: [['onpage_seo', 0.35], ['schema', 0.2], ['ai_llm', 0.15], ['indexability', 0.15], ['content', 0.15]],
  },
  mobile: { label: 'Mobile Responsiveness', members: [['ux', 1]] },
  speed: { label: 'Site Speed & Performance', members: [['performance', 1]] },
  site_health: { label: 'Site Age, Health & Errors', members: [['technical', 0.7], ['analytics', 0.3]] },
}

function compositeScore(
  result: AuditResult,
  members: ReadonlyArray<readonly [CategoryKey, number]>,
): number | null {
  let weighted = 0
  let totalWeight = 0
  for (const [key, weight] of members) {
    const s = result.category_scores[key]?.score
    if (s === null || s === undefined) continue
    weighted += s * weight
    totalWeight += weight
  }
  return totalWeight === 0 ? null : Math.round(weighted / totalWeight)
}

/** Tech Stack is unscored by the engine; derive a coarse 0–100 grade from the
 * count of risky/notable dependencies (e.g. a compromised polyfill.io). */
function techStackScore(result: AuditResult): number | null {
  const tech = result.intelligence?.tech_stack
  if (!tech) return null
  return Math.max(45, 92 - tech.risk_flags.length * 14)
}

function composite(result: AuditResult, key: keyof typeof COMPOSITES): DashboardBucket {
  const { label, members } = COMPOSITES[key]
  return { key, label, kind: 'composite', score: compositeScore(result, members), members: members.map(([k]) => k) }
}

/** The eight dashboard cards, in display order: three strategic intel cards
 * (when present), then the consolidated technical buckets. */
export function deriveDashboard(result: AuditResult): DashboardBucket[] {
  const intel = result.intelligence
  const cards: DashboardBucket[] = []

  if (intel?.target_market) {
    cards.push({ key: 'target_market', label: SECTION_LABELS.target_market, kind: 'intel', score: Math.round(intel.target_market.score * 10), members: [] })
  }
  if (intel?.competitive) {
    cards.push({ key: 'competitive', label: SECTION_LABELS.competitive, kind: 'intel', score: Math.round(intel.competitive.score * 10), members: [] })
  }
  if (intel?.niche_services) {
    cards.push({ key: 'niche_services', label: SECTION_LABELS.niche_services, kind: 'intel', score: Math.round(intel.niche_services.score * 10), members: [] })
  }

  cards.push(composite(result, 'seo_aio_geo'))
  cards.push(composite(result, 'mobile'))
  cards.push(composite(result, 'speed'))
  if (intel?.tech_stack) {
    cards.push({ key: 'tech_stack', label: 'Technology Stack', kind: 'tech_stack', score: techStackScore(result), members: [] })
  }
  cards.push(composite(result, 'site_health'))

  return cards
}

/** Hero pill counts: a card "passes" at A/B (≥80); C and below "need work". */
export function passingCounts(buckets: DashboardBucket[]): { passing: number; needsWork: number } {
  let passing = 0
  let needsWork = 0
  for (const b of buckets) {
    if (b.score === null) continue
    if (b.score >= 80) passing++
    else needsWork++
  }
  return { passing, needsWork }
}

/** Card labels in priority order for the recommendations "Section" column. */
const SECTION_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Niche & Services Intelligence', ['niche', 'vertical', 'industry page', 'service page']],
  ['Competitive Search Visibility', ['keyword', 'rank', 'competitor', 'search visibility', 'serp']],
  ['Target Market Clarity', ['trust signal', 'testimonial', 'positioning', 'audience', 'credibility', 'review']],
  ['Ongoing Content', ['syndicat', 'resource library', 'ebook', 'blog', 'article', 'original content']],
  ['Site Speed & Performance', ['load time', 'speed', 'performance', 'image optim', 'core web']],
  ['Mobile Responsiveness', ['mobile', 'responsive', 'viewport', 'tappable']],
  ['Technology Stack', ['polyfill', 'cms', 'wordpress', 'framework', 'plugin', 'tech stack']],
  ['Site Age, Health & Errors', ['ssl', 'redirect', 'broken link', '404', 'security header', 'sitemap', 'domain']],
  ['SEO / AIO / GEO Health', ['seo', 'schema', 'h1', 'meta description', 'heading', 'structured data', 'llms.txt', 'ai search', 'faq']],
]

/** Extra rows folded into the "Site Age, Health & Errors" card beside the
 * technical/analytics findings: domain age and crawl-error count. */
export function siteHealthExtraRows(result: AuditResult): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  const d = result.intelligence?.domain
  if (d?.age_years != null) rows.push({ label: 'Domain Age', value: `${d.age_years} years` })
  if (d?.registered) rows.push({ label: 'Domain Registered', value: d.registered })
  if (d?.last_updated) rows.push({ label: 'Last Content Update', value: d.last_updated })
  rows.push({ label: 'Crawl Errors', value: String(result.crawl_errors_count) })
  return rows
}

/** Best-effort attribution of a narrative recommendation to a report section
 * for the recs table. Display-only; falls back to "—" when nothing matches. */
export function inferSection(text: string): string {
  const t = text.toLowerCase()
  for (const [label, keywords] of SECTION_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) return label
  }
  return '—'
}
