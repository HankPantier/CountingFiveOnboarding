import { describe, expect, it } from 'vitest'
import { providerOptionsForAttempt } from './generation-tuning'

const effortOf = (n: number) =>
  (providerOptionsForAttempt(n).anthropic as { effort: string }).effort

describe('providerOptionsForAttempt', () => {
  it('leaves the first attempt at full quality', () => {
    expect(effortOf(1)).toBe('high')
  })

  it('steps effort down on each retry so a retry differs from what just failed', () => {
    // A page that timed out at high effort used to retry identically and time out
    // identically. In production the only attempt that landed was the one that
    // fell through to low effort (2,971 output tokens vs 12-17k).
    expect(effortOf(2)).toBe('medium')
    expect(effortOf(3)).toBe('low')
  })

  it('stays at the cheapest rung beyond the ladder', () => {
    expect(effortOf(4)).toBe('low')
    expect(effortOf(99)).toBe('low')
  })

  it('treats a nonsensical attempt number as the first attempt', () => {
    expect(effortOf(0)).toBe('high')
    expect(effortOf(-3)).toBe('high')
  })

  it('always keeps adaptive thinking omitted from the response', () => {
    for (const n of [1, 2, 3]) {
      const o = providerOptionsForAttempt(n).anthropic as { thinking: { type: string; display: string } }
      expect(o.thinking).toEqual({ type: 'adaptive', display: 'omitted' })
    }
  })
})
