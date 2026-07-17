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
  { key: 'local_seo', label: 'Local SEO', weight: 10 },
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

/** Semantic token straight from a 0–100 score — mirrors `gradeToken` thresholds
 * (A/B ≥80 success, C ≥70 warning, else error) without a Grade in hand. */
export function tokenForScore(score: number | null): SemanticToken {
  if (score === null) return 'muted'
  if (score >= 80) return 'success'
  if (score >= 70) return 'warning'
  return 'error'
}

/** Scores are 0–100. Clamp defensively so a stray out-of-range value — a
 * regressed double-scale (intel scores are already 0–100; never ×10 again), or
 * an over-eager AI sub-score — can never render as a nonsensical ">10 out of 10"
 * or an inflated grade. */
function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

/** Client-facing 0–10 display of a 0–100 score, one decimal (e.g. 82 → "8.2"). */
export function score10(score: number | null): string {
  return score === null ? '—' : (clampScore(score) / 10).toFixed(1)
}

/** US-style letter grade with +/- modifier from a 0–100 score. The shareable
 * report speaks in graded bands (e.g. "C+") rather than the engine's bare A–F;
 * thresholds follow the conventional GPA scale. */
export function gradeWithModifier(score: number | null): string {
  if (score === null) return 'N/A'
  const s = clampScore(score)
  const scale: ReadonlyArray<readonly [number, string]> = [
    [97, 'A+'], [93, 'A'], [90, 'A-'],
    [87, 'B+'], [83, 'B'], [80, 'B-'],
    [77, 'C+'], [73, 'C'], [70, 'C-'],
    [67, 'D+'], [63, 'D'], [60, 'D-'],
    [0, 'F'],
  ]
  for (const [min, g] of scale) if (s >= min) return g
  return 'F'
}

export function humanizeKey(key: string): string {
  return key
    .replace(/^pct_/, '% ')
    .replace(/_/g, ' ')
    .replace(/\bpct\b/g, '%')
    .replace(/\b(ssl|url|og|tw|ga4|gtm|ai|cta|html|css|nap|seo)\b/gi, (m) => m.toUpperCase())
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
  for (const [k, v] of Object.entries(findings ?? {})) {
    const formatted = formatValue(v)
    if (formatted === null) continue
    rows.push({ label: humanizeKey(k), value: formatted })
  }
  return rows
}
