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
