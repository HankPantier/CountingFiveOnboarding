import { describe, expect, it } from 'vitest'
import type { KeywordRanking, PageSummary, Recommendation } from '@/types/audit-result'
import {
  auditsOverview,
  keywordRankBars,
  pageInventoryStats,
  recommendationStats,
  sessionsOverview,
} from './report-aggregates'

function page(over: Partial<PageSummary>): PageSummary {
  return {
    url: 'https://x.com',
    status_code: 200,
    title: '',
    title_ok: true,
    title_len: 0,
    meta_desc: '',
    meta_ok: true,
    meta_len: 0,
    h1_count: 1,
    h1_text: '',
    schema_types: [],
    word_count: 500,
    og_complete: true,
    has_ga4: true,
    issues: [],
    content_snippet: '',
    suggested_title: null,
    suggested_meta: null,
    ...over,
  }
}

describe('keywordRankBars', () => {
  it('bands rank into tokens and inverts visibility', () => {
    const rankings: KeywordRanking[] = [
      { keyword: 'a', rank: 1, note: '' },
      { keyword: 'b', rank: 15, note: '' },
      { keyword: 'c', rank: 40, note: '' },
      { keyword: 'd', rank: null, note: 'not found' },
    ]
    const bars = keywordRankBars(rankings)
    expect(bars.map((b) => b.token)).toEqual(['success', 'warning', 'error', 'muted'])
    expect(bars[0].visibility).toBe(100)
    expect(bars[3].visibility).toBe(0)
    // visibility is strictly better for a better rank
    expect(bars[0].visibility).toBeGreaterThan(bars[1].visibility)
  })

  it('handles an empty list', () => {
    expect(keywordRankBars([])).toEqual([])
  })
})

describe('pageInventoryStats', () => {
  it('buckets status, schema coverage, words and issues', () => {
    const pages = [
      page({ status_code: 200, schema_types: ['Org'], word_count: 100, issues: [] }),
      page({ status_code: 301, schema_types: [], word_count: 500, issues: ['a'] }),
      page({ status_code: 404, schema_types: [], word_count: 1200, issues: ['a', 'b', 'c'] }),
      page({ status_code: 200, schema_types: ['FAQ'], word_count: 2000, issues: new Array(7).fill('x') }),
    ]
    const s = pageInventoryStats(pages)
    expect(s.total).toBe(4)
    expect(s.status).toEqual({ ok: 2, redirect: 1, error: 1 })
    expect(s.schemaCoveragePct).toBe(50)
    expect(s.wordBuckets.map((b) => b.count)).toEqual([1, 1, 1, 1])
    expect(s.issueBuckets.map((b) => b.count)).toEqual([1, 1, 1, 1])
  })

  it('returns zero coverage for no pages', () => {
    const s = pageInventoryStats([])
    expect(s.total).toBe(0)
    expect(s.schemaCoveragePct).toBe(0)
  })
})

describe('recommendationStats', () => {
  it('counts by priority, effort and category', () => {
    const recs: Recommendation[] = [
      { priority: 'critical', category: 'SEO', title: '', detail: '', effort: 'Low' },
      { priority: 'warning', category: 'SEO', title: '', detail: '', effort: 'High' },
      { priority: 'warning', category: 'Performance', title: '', detail: '', effort: 'Medium' },
    ]
    const s = recommendationStats(recs)
    expect(s.total).toBe(3)
    expect(s.byPriority).toEqual({ critical: 1, warning: 2 })
    expect(s.byEffort).toEqual({ Low: 1, Medium: 1, High: 1 })
    expect(s.byCategory[0]).toEqual({ category: 'SEO', count: 2 })
  })
})

describe('auditsOverview', () => {
  it('buckets scores, grades and statuses for completed runs only', () => {
    const o = auditsOverview([
      { audit_status: 'complete', overall_score: 95, overall_grade: 'A' },
      { audit_status: 'complete', overall_score: 55, overall_grade: 'F' },
      { audit_status: 'running', overall_score: null, overall_grade: null },
      { audit_status: 'error', overall_score: null, overall_grade: null },
    ])
    expect(o.completed).toBe(2)
    expect(o.scoreBuckets[4].count).toBe(1) // 80–100
    expect(o.scoreBuckets[2].count).toBe(1) // 40–60
    expect(o.grades).toEqual([
      { grade: 'A', count: 1 },
      { grade: 'F', count: 1 },
    ])
    expect(o.statuses.find((s) => s.status === 'running')?.count).toBe(1)
  })
})

describe('sessionsOverview', () => {
  it('builds a monotonic reached-phase funnel and status counts', () => {
    const o = sessionsOverview([
      { status: 'in_progress', current_phase: 3 },
      { status: 'approved', current_phase: 7 },
      { status: 'pending', current_phase: 0 },
    ])
    expect(o.total).toBe(3)
    expect(o.phases[0].count).toBe(3) // all reached phase 0
    expect(o.phases[4].count).toBe(1) // only the phase-7 session reached 4+
    expect(o.phases[7].count).toBe(1)
    // funnel never increases
    for (let i = 1; i < o.phases.length; i++) {
      expect(o.phases[i].count).toBeLessThanOrEqual(o.phases[i - 1].count)
    }
    expect(o.statuses).toHaveLength(3)
  })
})
