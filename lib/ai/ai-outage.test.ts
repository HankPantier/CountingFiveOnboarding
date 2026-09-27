import { describe, it, expect } from 'vitest'
import { aiOutageBannerCopy, isAiOutageKind, normalizeResetDate, usageLimitHasReset } from './ai-outage'

describe('aiOutageBannerCopy', () => {
  it('usage limit with a known reset date: the exact wording, date included', () => {
    const c = aiOutageBannerCopy('usage_limit', '2026-10-01')
    expect(c.body).toBe(
      'The Anthropic API usage limit has been reached — AI features are paused until 2026-10-01 or until the limit is raised in the Anthropic Console.'
    )
    expect(c.resolveLabel).toBe("I've raised the limit")
    expect(c.body).not.toMatch(/credit/i)
  })
  it('usage limit without a date says it resets or is raised', () => {
    expect(aiOutageBannerCopy('usage_limit', null).body).toBe(
      'The Anthropic API usage limit has been reached — AI features are paused until the limit resets or is raised in the Anthropic Console.'
    )
    expect(aiOutageBannerCopy('usage_limit', 'soon').body).not.toContain('soon')
  })
  it('credit keeps the credit wording', () => {
    const c = aiOutageBannerCopy('credit')
    expect(c.body).toMatch(/credits have run out/)
    expect(c.resolveLabel).toBe("I've added credits")
  })
})

describe('outage helpers', () => {
  it('isAiOutageKind / normalizeResetDate', () => {
    expect(isAiOutageKind('usage_limit')).toBe(true)
    expect(isAiOutageKind('credit')).toBe(true)
    expect(isAiOutageKind('auth')).toBe(false)
    expect(isAiOutageKind(null)).toBe(false)
    expect(normalizeResetDate('2026-10-01')).toBe('2026-10-01')
    expect(normalizeResetDate('2026-13-45')).toBeNull()
    expect(normalizeResetDate('2026-10-01T00:00:00Z')).toBeNull()
    expect(normalizeResetDate(undefined)).toBeNull()
  })
  it('usageLimitHasReset flips at 00:00 UTC on the reset date', () => {
    const at = Date.parse('2026-10-01T00:00:00Z')
    expect(usageLimitHasReset('2026-10-01', at - 1)).toBe(false)
    expect(usageLimitHasReset('2026-10-01', at)).toBe(true)
    expect(usageLimitHasReset(null, at)).toBe(false)
  })
})
