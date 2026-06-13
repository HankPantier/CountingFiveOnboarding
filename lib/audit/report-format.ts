// Pure formatting helpers shared by the in-app React report
// (components/admin/audit/*) and the standalone HTML export
// (lib/audit/html-report.ts). No React, no DOM.
import type { CategoryKey, Findings, Grade } from './types'

export const CATEGORY_META: Array<{ key: CategoryKey; label: string; weight: number }> = [
  { key: 'performance', label: 'Performance', weight: 20 },
  { key: 'technical', label: 'Technical Health', weight: 15 },
  { key: 'onpage_seo', label: 'On-Page SEO', weight: 15 },
  { key: 'ux', label: 'UX & Accessibility', weight: 10 },
  { key: 'content', label: 'Content Quality', weight: 10 },
  { key: 'indexability', label: 'Indexability', weight: 10 },
  { key: 'schema', label: 'Schema & Structured Data', weight: 10 },
  { key: 'ai_llm', label: 'AI / LLM Readiness', weight: 5 },
  { key: 'analytics', label: 'Analytics & Tracking', weight: 5 },
]

export type SemanticToken = 'success' | 'warning' | 'error' | 'muted'

/** Map a letter grade to a semantic design token. */
export function gradeToken(grade: Grade | null): SemanticToken {
  if (grade === null) return 'muted'
  if (grade === 'A' || grade === 'B') return 'success'
  if (grade === 'C') return 'warning'
  return 'error'
}

export function humanizeKey(key: string): string {
  return key
    .replace(/^pct_/, '% ')
    .replace(/_/g, ' ')
    .replace(/\bpct\b/g, '%')
    .replace(/\b(ssl|url|og|tw|ga4|gtm|ai|cta|html|css)\b/gi, (m) => m.toUpperCase())
    .replace(/^\w/, (c) => c.toUpperCase())
}

export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    if (value.every((v) => typeof v === 'string')) return value.join(', ')
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  return null // skip nested objects in the generic table
}

/** Render a URL into an href only if it's http/https — neutralizes
 * `javascript:`/`data:` URIs that survive HTML-entity escaping. */
export function safeHref(raw: string): string {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : '#'
  } catch {
    return '#'
  }
}

export function findingRows(
  findings: Findings[CategoryKey],
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  for (const [k, v] of Object.entries(findings)) {
    const formatted = formatValue(v)
    if (formatted === null) continue
    rows.push({ label: humanizeKey(k), value: formatted })
  }
  return rows
}
