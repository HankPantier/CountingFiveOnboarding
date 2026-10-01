import { describe, it, expect } from 'vitest'
import { judgeFindings, judgeUnavailableFinding, dedupeFindings, qaPasses, agentScores } from './judge'
import type { CriticReview } from '@/lib/content/critic-review'
import type { Finding } from '@/types/qa-review'

const good: CriticReview = {
  evidence_specificity: 8, information_gain: 8, brand_fidelity: 8, promise_fulfillment: 8,
  outline_coverage: 8, input_utilization: 8, differentiation: 8,
  unsupported_claims: [], missing_sections: [], notes: 'solid', critic_model: 'm', scored_at: 't',
}
const mk = (p: Partial<Finding>): Finding => ({ id: Math.random().toString(), agent: 'copy', severity: 'low', kind: 'k', quote: '', message: 'm', safety: 'flag', status: 'open', ...p })

describe('judge', () => {
  it('turns unsupported claims and missing sections into high flags', () => {
    const f = judgeFindings({ ...good, unsupported_claims: ['500 clients'], missing_sections: ['Pricing'] })
    expect(f.map(x => [x.kind, x.severity, x.safety])).toEqual([
      ['unsupported_claim', 'high', 'flag'], ['missing_section', 'high', 'flag'],
    ])
  })
  it('dedupes by kind + normalized quote', () => {
    const out = dedupeFindings([mk({ kind: 'unsupported_claim', quote: '500  Clients' }), mk({ kind: 'unsupported_claim', quote: '500 clients' })])
    expect(out).toHaveLength(1)
  })
  it('passes a clean page and fails on a weak judge or an open high copy finding', () => {
    expect(qaPasses(good, [])).toBe(true)
    expect(qaPasses({ ...good, unsupported_claims: ['x'] }, [])).toBe(false)
    expect(qaPasses(good, [mk({ agent: 'copy', severity: 'high' })])).toBe(false)
    expect(qaPasses(good, [mk({ agent: 'copy', severity: 'high', status: 'applied' })])).toBe(true)
    expect(qaPasses(null, [])).toBe(true)
  })
  it('fails when the judge could not run (open judge_unavailable finding)', () => {
    expect(qaPasses(null, [mk({ agent: 'judge', severity: 'high', kind: 'judge_unavailable' })])).toBe(false)
    expect(qaPasses(null, [mk({ agent: 'judge', severity: 'high', kind: 'judge_unavailable', status: 'dismissed' })])).toBe(true)
  })
  it('judgeUnavailableFinding is an open high flag from the judge', () => {
    expect(judgeUnavailableFinding()).toMatchObject({
      agent: 'judge', severity: 'high', kind: 'judge_unavailable', quote: '', safety: 'flag', status: 'open',
      message: 'The senior-editor accuracy check could not run on this page — proof facts by hand.',
    })
  })
  it('scores per agent from open findings', () => {
    const s = agentScores([
      mk({ agent: 'accuracy', severity: 'high' }),
      mk({ agent: 'judge', kind: 'unsupported_claim', severity: 'high' }),
      mk({ agent: 'rules', kind: 'media_side', severity: 'low', status: 'applied' }),
      mk({ agent: 'rules', kind: 'meta_length', severity: 'med' }),
    ])
    expect(s).toEqual({ accuracy: 4, copy: 10, seo: 9, structure: 10 })
  })
  it('rules copy_ai_pattern med finding lowers copy by 1', () => {
    const s = agentScores([
      mk({ agent: 'rules', kind: 'copy_ai_pattern', severity: 'med' }),
    ])
    expect(s).toEqual({ accuracy: 10, copy: 9, seo: 10, structure: 10 })
  })
})
