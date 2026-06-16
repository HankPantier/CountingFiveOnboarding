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

/** Sub-scores → display rows on the sample's 0–10 scale. */
export function subScoreRows(sub: Record<string, number>): Array<{ label: string; value: string }> {
  return Object.entries(sub).map(([k, v]) => ({ label: humanizeKey(k), value: `${v}/10` }))
}

export function signalLabel(signal: string): string {
  return `${signal.charAt(0).toUpperCase()}${signal.slice(1)} signal`
}
