import { describe, it, expect } from 'vitest'
import { callerCapUsd, createAbBudget, projectCallUsd } from './budget'

describe('createAbBudget', () => {
  it('admits calls while the projection fits, charges actual spend', () => {
    const b = createAbBudget(5)
    expect(b.admit(2)).toBe(true)
    b.charge(1.5)
    expect(b.admit(3.5)).toBe(true) // 1.5 + 3.5 = 5 — exactly at the cap is allowed
    b.charge(1)
    expect(b.spentUsd()).toBeCloseTo(2.5, 10)
    expect(b.tripped()).toBe(false)
  })

  it('refuses a call whose projection would exceed the cap and latches: every later call is skipped too', () => {
    const b = createAbBudget(3)
    b.charge(2.5)
    expect(b.admit(1)).toBe(false)
    expect(b.tripped()).toBe(true)
    // Even a tiny later call (e.g. a cheap critique) is refused once tripped.
    expect(b.admit(0.01)).toBe(false)
    expect(b.admit(0)).toBe(false)
  })

  it('ignores negative / non-finite charges and projections', () => {
    const b = createAbBudget(1)
    b.charge(-5)
    b.charge(Number.NaN)
    expect(b.spentUsd()).toBe(0)
    expect(b.admit(Number.NaN)).toBe(true)
    expect(b.admit(-2)).toBe(true)
  })

  it('rejects a non-positive cap', () => {
    expect(() => createAbBudget(0)).toThrow()
    expect(() => createAbBudget(Number.NaN)).toThrow()
  })
})

describe('projectCallUsd', () => {
  it('is the input estimate at the cache-write rate plus the full max output at the model’s output rate', () => {
    // Opus 5.5 output $20/M: 24k → $0.48; Fable 5.1 output $50/M: 24k → $1.20.
    expect(projectCallUsd({ model: 'claude-opus-5-5', inputUsd: 0.1, maxOutputTokens: 24_000 })).toBeCloseTo(0.605, 10)
    expect(projectCallUsd({ model: 'claude-fable-5-1', inputUsd: 0.25, maxOutputTokens: 24_000 })).toBeCloseTo(1.5125, 10)
  })
})

describe('callerCapUsd', () => {
  it('reserves one worst-case attempt so a retry / repair can never overshoot the cap', () => {
    const b = createAbBudget(10)
    expect(callerCapUsd(b, 1.5)).toBeCloseTo(8.5, 10)
    // Any attempt the caller still starts has spentSoFar < 8.5; adding ≤ 1.5 stays ≤ 10.
    expect(callerCapUsd(b, 12)).toBe(0)
    expect(callerCapUsd(b, Number.NaN)).toBe(10)
  })
})
