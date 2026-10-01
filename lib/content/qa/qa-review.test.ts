import { describe, it, expect } from 'vitest'
import { parseQaReview, summarizeQa, type QaReview } from '@/types/qa-review'

const review: QaReview = {
  mode: 'on',
  ran_at: '2026-10-01T00:00:00Z',
  findings: [
    { id: 'a', agent: 'copy', severity: 'low', kind: 'filler', quote: 'x', message: 'm', safety: 'auto', status: 'applied' },
    { id: 'b', agent: 'accuracy', severity: 'high', kind: 'unsupported_claim', quote: 'y', message: 'm', safety: 'flag', status: 'open' },
    { id: 'c', agent: 'seo', severity: 'med', kind: 'meta_length', quote: 'z', message: 'm', safety: 'flag', status: 'dismissed' },
  ],
  scores: { accuracy: 6, copy: 9, seo: 8, structure: 10 },
  judge: null,
  passed: false,
}

describe('parseQaReview', () => {
  it('round-trips a valid review', () => {
    expect(parseQaReview(JSON.parse(JSON.stringify(review)))).toEqual(review)
  })
  it('rejects garbage and drops malformed findings', () => {
    expect(parseQaReview(null)).toBeNull()
    expect(parseQaReview({ mode: 'on' })).toBeNull()
    const r = parseQaReview({ ...review, findings: [...review.findings, { id: 1 }] })
    expect(r?.findings).toHaveLength(3)
  })
})

describe('summarizeQa', () => {
  it('counts applied as fixed and open as needs-you', () => {
    expect(summarizeQa(review)).toEqual({ fixed: 1, open: 1, highOpen: 1, passed: false, judgeOverall: null, mode: 'on' })
  })
})
