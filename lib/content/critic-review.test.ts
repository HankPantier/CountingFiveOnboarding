import { describe, it, expect } from 'vitest'
import {
  parseCritic,
  summarizeCritic,
  criticOverall,
  clampScore,
  criticFailsThreshold,
  decideCriticAction,
  buildCriticGuidance,
  readCriticRegenAttempts,
  MAX_CRITIC_REGEN,
} from './critic-review'

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
    // claims present → hasFlags + needsReview (via threshold fallback)
    expect(s).toEqual({ overall: 8, hasFlags: true, needsReview: true, regenerated: false })
  })

  it('reports no flags and no review needed for a clean high-scoring page', () => {
    expect(summarizeCritic({
      evidence_specificity: 6, information_gain: 6, brand_fidelity: 6, promise_fulfillment: 6,
      unsupported_claims: [], notes: '',
    })).toEqual({ overall: 6, hasFlags: false, needsReview: false, regenerated: false })
  })

  it('prefers the persisted needs_human_review flag over the live threshold', () => {
    // Scores all pass the threshold, but the row was explicitly flagged after the
    // auto-regen budget was spent — the persisted flag wins.
    const s = summarizeCritic({
      evidence_specificity: 8, information_gain: 8, brand_fidelity: 8, promise_fulfillment: 8,
      unsupported_claims: [], notes: '', needs_human_review: true, regenerated: true,
      critic_regen_attempts: 1,
    })
    expect(s).toEqual({ overall: 8, hasFlags: false, needsReview: true, regenerated: true })
  })

  it('returns null for a missing/malformed stored value', () => {
    expect(summarizeCritic(null)).toBeNull()
    expect(summarizeCritic({})).toBeNull()
  })
})

describe('criticFailsThreshold', () => {
  const strong = { evidence_specificity: 8, information_gain: 7, brand_fidelity: 9, promise_fulfillment: 8, unsupported_claims: [] as string[] }

  it('passes a strong page with no unsupported claims', () => {
    expect(criticFailsThreshold(strong)).toBe(false)
  })

  it('fails when any unsupported claim is present, even with high scores', () => {
    expect(criticFailsThreshold({ ...strong, unsupported_claims: ['Rated #1 in the state'] })).toBe(true)
  })

  it('tolerates a single weak dimension on an otherwise-strong page (no costly rewrite)', () => {
    expect(criticFailsThreshold({ ...strong, information_gain: 3 })).toBe(false)
  })

  it('fails when two or more dimensions are weak', () => {
    expect(criticFailsThreshold({ ...strong, information_gain: 4, brand_fidelity: 4 })).toBe(true)
  })

  it('fails when the overall score is mediocre (all 5s → overall 5 < 6)', () => {
    expect(criticFailsThreshold({
      evidence_specificity: 5, information_gain: 5, brand_fidelity: 5, promise_fulfillment: 5, unsupported_claims: [],
    })).toBe(true)
  })

  it('passes a solid page at the overall boundary (all 6s → overall 6)', () => {
    expect(criticFailsThreshold({
      evidence_specificity: 6, information_gain: 6, brand_fidelity: 6, promise_fulfillment: 6, unsupported_claims: [],
    })).toBe(false)
  })
})

describe('decideCriticAction', () => {
  const strong = { evidence_specificity: 8, information_gain: 7, brand_fidelity: 9, promise_fulfillment: 8, unsupported_claims: [] as string[] }
  const weak = { evidence_specificity: 4, information_gain: 4, brand_fidelity: 5, promise_fulfillment: 5, unsupported_claims: [] as string[] }

  it('accepts a solid page regardless of prior attempts', () => {
    expect(decideCriticAction(strong, 0)).toBe('accept')
    expect(decideCriticAction(strong, MAX_CRITIC_REGEN)).toBe('accept')
  })

  it('regenerates a weak page that still has budget', () => {
    expect(decideCriticAction(weak, 0)).toBe('regenerate')
  })

  it('flags a weak page once the regen budget is spent', () => {
    expect(decideCriticAction(weak, MAX_CRITIC_REGEN)).toBe('flag')
    expect(decideCriticAction(weak, MAX_CRITIC_REGEN + 3)).toBe('flag')
  })
})

describe('buildCriticGuidance', () => {
  it('lists unsupported claims and editor notes as fix-these guidance', () => {
    const g = buildCriticGuidance({ unsupported_claims: ['500+ clients', '#1 rated'], notes: 'Thin on the tax section.' })
    expect(g).toContain('500+ clients')
    expect(g).toContain('#1 rated')
    expect(g).toContain('Thin on the tax section.')
  })

  it('is empty when there is nothing to fix', () => {
    expect(buildCriticGuidance({ unsupported_claims: [], notes: '' })).toBe('')
  })

  it('includes only notes when there are no claims', () => {
    const g = buildCriticGuidance({ unsupported_claims: [], notes: 'Tighten the intro.' })
    expect(g).toContain('Tighten the intro.')
    expect(g).not.toContain('unsupported specifics')
  })
})

describe('readCriticRegenAttempts', () => {
  it('reads a persisted attempt count', () => {
    expect(readCriticRegenAttempts({ critic_regen_attempts: 1 })).toBe(1)
  })
  it('defaults to 0 for legacy/absent/garbled values', () => {
    expect(readCriticRegenAttempts(null)).toBe(0)
    expect(readCriticRegenAttempts({})).toBe(0)
    expect(readCriticRegenAttempts({ critic_regen_attempts: 'two' })).toBe(0)
    expect(readCriticRegenAttempts({ critic_regen_attempts: -4 })).toBe(0)
    expect(readCriticRegenAttempts('nope')).toBe(0)
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
