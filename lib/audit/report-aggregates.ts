// Pure aggregation helpers that turn audit/admin row data into chart-ready
// arrays. No React, no DOM — unit-tested, and safe to call from Server
// Components. Mirrors the style of report-format.ts / lib/tokens/aggregate.ts.
import type { KeywordRanking, PageSummary, Recommendation } from '@/types/audit-result'
import type { SemanticToken } from './report-format'

// ── A1: competitive keyword rankings ─────────────────────────────────────────

export interface KeywordBar {
  keyword: string
  rank: number | null
  note: string
  /** 0–100 visibility score (higher = better) so a #1 renders as the longest
   * bar; not-ranking is 0. Derived as 101 − rank. */
  visibility: number
  token: SemanticToken
}

/** Page 1 (≤10) reads as strong, page 2 (≤20) as needs-work, deeper as poor,
 * not-found as muted. */
function rankBandToken(rank: number | null): SemanticToken {
  if (rank === null) return 'muted'
  if (rank <= 10) return 'success'
  if (rank <= 20) return 'warning'
  return 'error'
}

export function keywordRankBars(rankings: KeywordRanking[]): KeywordBar[] {
  return rankings.map((k) => ({
    keyword: k.keyword,
    rank: k.rank,
    note: k.note,
    visibility: k.rank === null ? 0 : Math.max(0, Math.min(100, 101 - k.rank)),
    token: rankBandToken(k.rank),
  }))
}

// ── A3: page inventory aggregates ────────────────────────────────────────────

export interface Bucket {
  label: string
  count: number
}

export interface PageInventoryStats {
  total: number
  status: { ok: number; redirect: number; error: number }
  schemaCoveragePct: number
  wordBuckets: Bucket[]
  issueBuckets: Bucket[]
}

export function pageInventoryStats(pages: PageSummary[]): PageInventoryStats {
  const status = { ok: 0, redirect: 0, error: 0 }
  let withSchema = 0
  const word = [0, 0, 0, 0]
  const issue = [0, 0, 0, 0]

  for (const p of pages) {
    const s = p.status_code
    if (s >= 200 && s < 300) status.ok++
    else if (s >= 300 && s < 400) status.redirect++
    else status.error++

    if (p.schema_types.length > 0) withSchema++

    const w = p.word_count
    if (w < 300) word[0]++
    else if (w < 800) word[1]++
    else if (w < 1500) word[2]++
    else word[3]++

    const n = p.issues.length
    if (n === 0) issue[0]++
    else if (n <= 2) issue[1]++
    else if (n <= 5) issue[2]++
    else issue[3]++
  }

  return {
    total: pages.length,
    status,
    schemaCoveragePct: pages.length ? Math.round((withSchema / pages.length) * 100) : 0,
    wordBuckets: [
      { label: '<300', count: word[0] },
      { label: '300–800', count: word[1] },
      { label: '800–1500', count: word[2] },
      { label: '1500+', count: word[3] },
    ],
    issueBuckets: [
      { label: '0', count: issue[0] },
      { label: '1–2', count: issue[1] },
      { label: '3–5', count: issue[2] },
      { label: '6+', count: issue[3] },
    ],
  }
}

// ── A4: recommendations breakdown ────────────────────────────────────────────

export interface RecommendationStats {
  total: number
  byPriority: { critical: number; warning: number }
  byEffort: { Low: number; Medium: number; High: number }
  byCategory: Array<{ category: string; count: number }>
}

export function recommendationStats(recs: Recommendation[]): RecommendationStats {
  const byPriority = { critical: 0, warning: 0 }
  const byEffort = { Low: 0, Medium: 0, High: 0 }
  const cat = new Map<string, number>()

  for (const r of recs) {
    if (r.priority === 'critical') byPriority.critical++
    else byPriority.warning++
    if (r.effort === 'Low' || r.effort === 'Medium' || r.effort === 'High') byEffort[r.effort]++
    cat.set(r.category, (cat.get(r.category) ?? 0) + 1)
  }

  return {
    total: recs.length,
    byPriority,
    byEffort,
    byCategory: [...cat.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  }
}

// ── B2: audits list overview ─────────────────────────────────────────────────

export interface AuditOverviewRow {
  audit_status: string
  overall_score: number | null
  overall_grade: string | null
}

export interface AuditsOverview {
  scoreBuckets: Bucket[]
  grades: Array<{ grade: string; count: number }>
  statuses: Array<{ status: string; count: number }>
  completed: number
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'] as const

export function auditsOverview(rows: AuditOverviewRow[]): AuditsOverview {
  const score = [0, 0, 0, 0, 0]
  const grade = new Map<string, number>()
  const status = new Map<string, number>()
  let completed = 0

  for (const r of rows) {
    status.set(r.audit_status, (status.get(r.audit_status) ?? 0) + 1)
    if (r.audit_status === 'complete' && r.overall_score !== null) {
      completed++
      score[Math.min(4, Math.floor(r.overall_score / 20))]++
      if (r.overall_grade) grade.set(r.overall_grade, (grade.get(r.overall_grade) ?? 0) + 1)
    }
  }

  return {
    scoreBuckets: ['0–20', '20–40', '40–60', '60–80', '80–100'].map((label, i) => ({
      label,
      count: score[i],
    })),
    grades: GRADE_ORDER.filter((g) => grade.has(g)).map((g) => ({ grade: g, count: grade.get(g)! })),
    statuses: [...status.entries()].map(([s, count]) => ({ status: s, count })),
    completed,
  }
}

// ── B3: sessions onboarding funnel ───────────────────────────────────────────

export interface SessionsOverview {
  /** Funnel: how many sessions have reached at least each phase (monotonic). */
  phases: Array<{ phase: number; label: string; count: number }>
  statuses: Array<{ status: string; count: number }>
  total: number
}

export function sessionsOverview(
  rows: Array<{ status: string; current_phase: number }>,
): SessionsOverview {
  const reached = new Array(8).fill(0)
  const status = new Map<string, number>()

  for (const r of rows) {
    const p = Math.max(0, Math.min(7, r.current_phase))
    for (let i = 0; i <= p; i++) reached[i]++
    status.set(r.status, (status.get(r.status) ?? 0) + 1)
  }

  return {
    phases: reached.map((count, i) => ({ phase: i, label: `Phase ${i}`, count })),
    statuses: [...status.entries()].map(([s, count]) => ({ status: s, count })),
    total: rows.length,
  }
}
