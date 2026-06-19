// Pure display helpers for the intelligence layer, shared by the standalone
// HTML export (lib/audit/html-report.ts) and the in-app React report
// (components/admin/audit/AuditReport.tsx). No React, no DOM.
import { humanizeKey } from './report-format'

/** Human labels for narrative section_commentary keys + intelligence headings. */
export const SECTION_LABELS: Record<string, string> = {
  performance: 'Performance',
  technical: 'Technical Health',
  onpage_seo: 'On-Page SEO',
  ux: 'UX & Accessibility',
  content: 'Content Quality',
  indexability: 'Indexability',
  schema: 'Schema & Structured Data',
  ai_llm: 'AI / LLM Readiness',
  analytics: 'Analytics & Tracking',
  target_market: 'Target Market Clarity',
  niche_services: 'Niche & Services Intelligence',
  competitive: 'Competitive Search Visibility',
  tech_stack: 'Technology Stack',
  content_library: 'Ongoing Content — Resource Library',
  digital_intelligence: 'Digital Intelligence Brief',
}

/** One-line "what this measures" help text per section, shown in the accordion
 * header tooltips. Keyed by SECTION_LABELS keys plus the non-scored sections
 * (dashboard, change, page_inventory, narrative_recs, recommendations). */
export const SECTION_HELP: Record<string, string> = {
  dashboard: 'At-a-glance grades for every scored area — strategic positioning first, then technical health.',
  target_market: 'How clearly the site signals who you serve — the audience inferred in seconds.',
  competitive: 'Visibility against competitors in search and AI answers for the terms that matter.',
  niche_services: 'How sharply specializations and services are defined vs. generic messaging.',
  seo_aio_geo: 'Search, AI, and structured-data health: titles, headings, schema, indexability, and on-page content.',
  mobile: 'Mobile usability and accessibility: viewport, tappable controls, form labels, navigation.',
  speed: 'Page speed and Core Web Vitals on mobile and desktop.',
  site_health: 'Foundational site health: SSL, redirects, security headers, analytics, domain age, and crawl errors.',
  performance: 'Page speed and Core Web Vitals on mobile and desktop.',
  technical: 'Foundational site health: SSL, redirects, crawlability, security headers.',
  onpage_seo: 'On-page fundamentals: titles, meta descriptions, headings, image alt text.',
  ux: 'Usability and accessibility: mobile viewport, tappable controls, form labels, navigation.',
  content: 'Depth, readability, trust signals, and clear calls to action.',
  indexability: 'Whether search engines can find and index pages — sitemaps, robots, indexed count.',
  schema: 'Structured data (Schema.org) that helps search engines and AI understand the business.',
  ai_llm: 'Readiness for AI assistants — llms.txt, FAQ markup, machine-readable facts.',
  analytics: 'Measurement coverage: analytics, tag manager, conversion and ad pixels.',
  tech_stack: 'Platform, hosting, and frameworks behind the site, plus domain age and last update.',
  content_library: 'Ongoing content footprint — articles, eBooks, resources, and publishing cadence.',
  digital_intelligence: 'Off-site research: people, reputation, affiliations, social presence (not scored).',
  narrative_recs: 'Highest-impact moves, framed by business outcome and how we would help execute.',
  recommendations: 'Full prioritized list of technical fixes, sorted by priority and effort.',
  change: 'How each score moved since the previous audit of this domain.',
  page_inventory: 'Every crawled page with its title, status, structured data, word count, and issues.',
}

/** The three strategic scored sections, in the order they lead the report —
 * promoted ahead of the deterministic technical categories. */
export const INTEL_LEAD_KEYS = ['target_market', 'competitive', 'niche_services'] as const
export type IntelLeadKey = (typeof INTEL_LEAD_KEYS)[number]

/** Intelligence section scores are on a 0–10 scale; normalize to a 0–100
 * percent so dashboard score bars share one axis with the 0–100 categories. */
export function intelScorePct(score: number): number {
  return Math.max(0, Math.min(100, score * 10))
}

/** Sub-scores → display rows on the sample's 0–10 scale. */
export function subScoreRows(sub: Record<string, number>): Array<{ label: string; value: string }> {
  return Object.entries(sub).map(([k, v]) => ({ label: humanizeKey(k), value: `${v}/10` }))
}

export function signalLabel(signal: string): string {
  return `${signal.charAt(0).toUpperCase()}${signal.slice(1)} signal`
}
