import { describe, it, expect } from 'vitest'
import { critiquePasses, minScoreFor, parseCritiqueAnswer, parseCritiqueRecord, rubricMean, type RubricScores } from './critique'

const S = (over: Partial<RubricScores> = {}): RubricScores => ({ brandFit: 4, distinctiveness: 4, hierarchy: 4, legibility: 4, consistency: 4, craft: 4, ...over })
const ANSWER = {
  scores: S(),
  reasons: { brandFit: 'On voice', distinctiveness: 'Own direction', hierarchy: 'Clear CTA', legibility: 'Readable', consistency: 'Holds together', craft: 'Tidy' },
  issues: [{ area: 'hero', problem: 'CTA blends in', fix: 'Use the action colour on the hero button' }],
  summary: 'Solid.',
}
const META = { iteration: 0, model: 'claude-opus-5-5', at: '2026-09-25T12:00:00.000Z' }

describe('pass rule (spec: all ≥ 3, mean ≥ 3.8, distinctiveness ≥ 4)', () => {
  it.each([
    [S(), true],
    [S({ craft: 3, legibility: 3 }), false], // mean 3.67
    [S({ craft: 3 }), true], // mean 3.83
    [S({ distinctiveness: 3, brandFit: 5, craft: 5 }), false], // distinctiveness below 4
    [S({ craft: 2, brandFit: 5, hierarchy: 5 }), false], // one score below 3
  ])('%j → %s', (scores, pass) => expect(critiquePasses(scores)).toBe(pass))
  it('mean is rounded to 2 decimals for display', () => expect(rubricMean(S({ craft: 3 }))).toBe(3.83))
  it('distinctiveness has a higher bar than the rest', () => {
    expect(minScoreFor('distinctiveness')).toBe(4)
    expect(minScoreFor('craft')).toBe(3)
  })
})

describe('parseCritiqueAnswer', () => {
  it('computes passed server-side — the model’s pass flag is ignored', () => {
    const r = parseCritiqueAnswer({ ...ANSWER, scores: S({ distinctiveness: 2 }), pass: true, passed: true }, META)
    expect(r.ok && r.record.passed).toBe(false)
    const ok = parseCritiqueAnswer(ANSWER, META)
    expect(ok.ok && ok.record).toMatchObject({ passed: true, mean: 4, iteration: 0, model: 'claude-opus-5-5', at: META.at })
  })
  it('rounds fractional scores, clips long text, keeps at most 6 issues, defaults a missing reason / summary', () => {
    const issues = Array.from({ length: 9 }, (_, i) => ({ area: `a${i}`, problem: 'p'.repeat(500), fix: 'f' }))
    const r = parseCritiqueAnswer({ ...ANSWER, scores: S({ craft: 3.6 }), reasons: { brandFit: 'x' }, issues, summary: undefined }, META)
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(r.record.scores.craft).toBe(4)
    expect(r.record.issues).toHaveLength(6)
    expect(r.record.issues[0].problem).toHaveLength(300)
    expect(r.record.reasons.craft).toBe('')
    expect(r.record.summary).toBe('')
  })
  it('rejects a missing score or one outside 1–5', () => {
    expect(parseCritiqueAnswer({ ...ANSWER, scores: { ...S(), craft: undefined } }, META).ok).toBe(false)
    expect(parseCritiqueAnswer({ ...ANSWER, scores: S({ craft: 7 }) }, META).ok).toBe(false)
    expect(parseCritiqueAnswer('nope', META).ok).toBe(false)
  })
})

describe('parseCritiqueRecord', () => {
  it('re-derives passed / mean from stored scores (never trusts the stored flag)', () => {
    const ok = parseCritiqueAnswer(ANSWER, META)
    if (!ok.ok) throw new Error('fixture')
    const tampered = { ...ok.record, scores: S({ distinctiveness: 1 }), passed: true }
    expect(parseCritiqueRecord(JSON.parse(JSON.stringify(tampered)))?.passed).toBe(false)
    expect(parseCritiqueRecord({ nope: 1 })).toBeNull()
  })
})
