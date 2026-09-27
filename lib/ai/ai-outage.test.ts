import { describe, it, expect } from 'vitest'
import { aiOutageBannerCopy, isAiOutageKind, normalizeResetDate, usageLimitHasReset } from './ai-outage'

describe('aiOutageBannerCopy', () => {
  // The banner renders "<title> — <body>".
  const line = (c: { title: string; body: string }) => `${c.title} — ${c.body}`
  it('usage limit with a known reset date reads as one clean sentence, date included', () => {
    const c = aiOutageBannerCopy('usage_limit', '2026-10-01')
    expect(line(c)).toBe(
      'AI features are paused — the Anthropic API usage limit was reached. Access returns 2026-10-01, or raise the limit in the Anthropic Console.'
    )
    expect(c.resolveLabel).toBe("I've raised the limit")
    expect(c.body).not.toMatch(/credit/i)
  })
  it('usage limit without a date says access returns when it resets', () => {
    expect(line(aiOutageBannerCopy('usage_limit', null))).toBe(
      'AI features are paused — the Anthropic API usage limit was reached. Access returns when the limit resets, or raise the limit in the Anthropic Console.'
    )
    expect(aiOutageBannerCopy('usage_limit', 'soon').body).not.toContain('soon')
  })
  it('credit keeps its original wording and casing', () => {
    const c = aiOutageBannerCopy('credit')
    expect(line(c)).toBe(
      "AI features are paused — the account's Claude API credits have run out. Add credits in the Anthropic console to restore content generation, AI editing, and audits. Retrying won't help until then."
    )
    expect(c.resolveLabel).toBe("I've added credits")
  })
  it('the body never repeats the title and never starts upper-case', () => {
    for (const c of [aiOutageBannerCopy('credit'), aiOutageBannerCopy('usage_limit', '2026-10-01'), aiOutageBannerCopy('usage_limit')]) {
      expect(c.body).not.toMatch(/AI features are paused/i)
      expect(c.body[0]).toBe(c.body[0].toLowerCase())
    }
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
