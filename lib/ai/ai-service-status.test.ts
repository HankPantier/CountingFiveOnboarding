import { describe, it, expect } from 'vitest'
import { isCreditRecent, CREDIT_STALE_MS } from './ai-service-status'

describe('isCreditRecent', () => {
  const now = 1_000_000_000_000
  const iso = (ms: number) => new Date(ms).toISOString()

  it('is false with no timestamp', () => {
    expect(isCreditRecent(null, now)).toBe(false)
    expect(isCreditRecent(undefined, now)).toBe(false)
  })

  it('is true for a failure inside the stale window', () => {
    expect(isCreditRecent(iso(now - 60_000), now)).toBe(true) // 1 min ago
    expect(isCreditRecent(iso(now - (CREDIT_STALE_MS - 1)), now)).toBe(true) // just inside
  })

  it('self-heals: false once the failure ages past the window', () => {
    expect(isCreditRecent(iso(now - CREDIT_STALE_MS - 1), now)).toBe(false)
    expect(isCreditRecent(iso(now - 60 * 60 * 1000), now)).toBe(false) // 1h ago
  })

  it('is false for a garbled timestamp', () => {
    expect(isCreditRecent('not-a-date', now)).toBe(false)
  })
})
