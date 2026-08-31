import { describe, it, expect } from 'vitest'
import { parseCritic, summarizeCritic, criticOverall, clampScore } from './critic-review'

describe('parseCritic', () => {
  const valid = {
    evidence_specificity: 8,
    information_gain: 6,
    brand_fidelity: 9,
    promise_fulfillment: 7,
    unsupported_claims: ['Serving 500+ clients since 1998', 'Rated #1 in the state'],
    notes: 'Strong page; verify the client count.',
  }

  it('parses a valid critic answer', () => {
    const r = parseCritic(valid)
    expect(r).not.toBeNull()
    expect(r?.evidence_specificity).toBe(8)
    expect(r?.promise_fulfillment).toBe(7)
    expect(r?.unsupported_claims).toEqual(['Serving 500+ clients since 1998', 'Rated #1 in the state'])
    expect(r?.notes).toBe('Strong page; verify the client count.')
  })

  it('returns null (fail-soft) when the four scores are not all numeric', () => {
    // A garbled/empty answer must record nothing rather than a misleading 0/10.
    expect(parseCritic({ evidence_specificity: 8, information_gain: 6, brand_fidelity: 9 })).toBeNull()
    expect(parseCritic({ ...valid, brand_fidelity: 'high' })).toBeNull()
    expect(parseCritic(null)).toBeNull()
    expect(parseCritic('not an object')).toBeNull()
    expect(parseCritic(42)).toBeNull()
  })

  it('clamps scores to 0-10 and rounds', () => {
    const r = parseCritic({
      evidence_specificity: 15,
      information_gain: -3,
      brand_fidelity: 7.6,
      promise_fulfillment: 4.2,
      unsupported_claims: [],
      notes: '',
    })
    expect(r?.evidence_specificity).toBe(10)
    expect(r?.information_gain).toBe(0)
    expect(r?.brand_fidelity).toBe(8)
    expect(r?.promise_fulfillment).toBe(4)
  })

  it('sanitizes unsupported_claims: drops non-strings/blanks, trims, caps length and count', () => {
    const r = parseCritic({
      ...valid,
      unsupported_claims: ['  real claim  ', '', '   ', 42, null, 'x'.repeat(400), ...Array(30).fill('dupe')],
    })
    expect(r?.unsupported_claims[0]).toBe('real claim')
    // 400-char entry is capped to 300
    expect(r?.unsupported_claims.some(c => c.length === 300)).toBe(true)
    // total capped at 20
    expect(r?.unsupported_claims.length).toBeLessThanOrEqual(20)
    expect(r?.unsupported_claims).not.toContain('')
  })

  it('defaults notes to empty string when missing or non-string', () => {
    expect(parseCritic({ ...valid, notes: undefined })?.notes).toBe('')
    expect(parseCritic({ ...valid, notes: 123 })?.notes).toBe('')
  })
})

describe('criticOverall', () => {
  it('averages the four scores and rounds', () => {
    expect(criticOverall({ evidence_specificity: 8, information_gain: 6, brand_fidelity: 9, promise_fulfillment: 7 })).toBe(8)
    expect(criticOverall({ evidence_specificity: 5, information_gain: 5, brand_fidelity: 6, promise_fulfillment: 6 })).toBe(6)
  })
})

describe('summarizeCritic', () => {
  it('summarizes a stored review with a flag when claims exist', () => {
    const s = summarizeCritic({
      evidence_specificity: 8,
      information_gain: 6,
      brand_fidelity: 9,
      promise_fulfillment: 7,
      unsupported_claims: ['Serving 500+ clients'],
      notes: 'ok',
      critic_model: 'claude-sonnet-5',
      scored_at: '2026-08-31T00:00:00.000Z',
    })
    expect(s).toEqual({ overall: 8, hasFlags: true })
  })

  it('reports no flags when unsupported_claims is empty', () => {
    expect(summarizeCritic({
      evidence_specificity: 5, information_gain: 5, brand_fidelity: 5, promise_fulfillment: 5,
      unsupported_claims: [], notes: '',
    })).toEqual({ overall: 5, hasFlags: false })
  })

  it('returns null for a missing/malformed stored value', () => {
    expect(summarizeCritic(null)).toBeNull()
    expect(summarizeCritic({})).toBeNull()
  })
})

describe('clampScore', () => {
  it('handles numeric strings and NaN', () => {
    expect(clampScore('7')).toBe(7)
    expect(clampScore('abc')).toBe(0)
    expect(clampScore(undefined)).toBe(0)
    expect(clampScore(11)).toBe(10)
  })
})
