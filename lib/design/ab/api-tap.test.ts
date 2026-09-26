import { describe, it, expect } from 'vitest'
import { addUsage, apiErrorSummary, parseAnthropicUsage, ZERO_USAGE } from './api-tap'

describe('parseAnthropicUsage', () => {
  it('reads the Messages API usage block (cache split separately)', () => {
    expect(
      parseAnthropicUsage({ usage: { input_tokens: 120, output_tokens: 900, cache_read_input_tokens: 5000, cache_creation_input_tokens: 40 } })
    ).toEqual({ inputTokens: 120, outputTokens: 900, cacheReadTokens: 5000, cacheWriteTokens: 40 })
  })
  it('defaults missing / bad numbers to 0 and returns null without a usage block', () => {
    expect(parseAnthropicUsage({ usage: { input_tokens: 'x', output_tokens: -1 } })).toEqual(ZERO_USAGE)
    expect(parseAnthropicUsage({ type: 'error' })).toBeNull()
    expect(parseAnthropicUsage(null)).toBeNull()
  })
  it('adds usage', () => {
    const a = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }
    expect(addUsage(a, a)).toEqual({ inputTokens: 2, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 8 })
  })
})

describe('apiErrorSummary', () => {
  it('summarizes an Anthropic error body', () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'effort is not supported for this model' } })
    expect(apiErrorSummary(400, body)).toBe('HTTP 400 invalid_request_error: effort is not supported for this model')
  })
  it('falls back to the clipped raw text', () => {
    expect(apiErrorSummary(502, 'Bad gateway')).toBe('HTTP 502 Bad gateway')
    expect(apiErrorSummary(500, 'x'.repeat(1000)).length).toBeLessThan(320)
    expect(apiErrorSummary(503, '')).toBe('HTTP 503')
  })
})
