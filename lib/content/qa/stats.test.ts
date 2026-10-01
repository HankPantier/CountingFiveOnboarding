import { describe, it, expect } from 'vitest'
import { qaStats } from './stats'

const r = (findings: Array<[string, string, string]>, passed: boolean) => ({
  mode: 'on', ran_at: 't', judge: null, passed, scores: { accuracy: 8, copy: 10, seo: 6, structure: 10 },
  findings: findings.map(([agent, kind, status], i) => ({ id: String(i), agent, kind, status, severity: 'low', quote: '', message: 'm', safety: 'flag' })),
})

describe('qaStats', () => {
  it('aggregates scores, pass rate and per-kind dismiss rate', () => {
    const s = qaStats([
      r([['copy', 'generic_phrasing', 'applied'], ['seo', 'meta_title', 'dismissed']], true),
      r([['seo', 'meta_title', 'accepted'], ['seo', 'meta_title', 'dismissed']], false),
      null,
    ])
    expect(s.pages).toBe(2)
    expect(s.passRate).toBe(0.5)
    expect(s.avgScores.seo).toBe(6)
    expect(s.byKind[0]).toMatchObject({ agent: 'seo', kind: 'meta_title', accepted: 1, dismissed: 2, dismissRate: 2 / 3 })
  })
})
