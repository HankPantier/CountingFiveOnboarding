import { describe, expect, it } from 'vitest'
import { MAX_RATE_LIMIT_WAIT_S, shouldRetryRateLimit } from './app-client'

describe('shouldRetryRateLimit (single retry layer, bounded wait)', () => {
  it('retries once for a short wait', () => {
    expect(shouldRetryRateLimit(30, 0)).toBe(true)
    expect(shouldRetryRateLimit(30, 1)).toBe(false)
  })
  it('never waits out a long primary-quota reset', () => {
    expect(shouldRetryRateLimit(MAX_RATE_LIMIT_WAIT_S + 1, 0)).toBe(false)
  })
})
