import { describe, expect, it } from 'vitest'
import { APICallError } from 'ai'
import { classifyAiError, aiStreamErrorMessage, ANTHROPIC_STATUS_URL } from './ai-error'

function apiError(statusCode: number, { message = 'boom', isRetryable = false } = {}) {
  return new APICallError({
    message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  })
}

describe('classifyAiError — Anthropic API status codes', () => {
  it('treats 529 overloaded as a provider issue with next steps', () => {
    const info = classifyAiError(apiError(529))
    expect(info.isProviderIssue).toBe(true)
    expect(info.kind).toBe('overloaded')
    expect(info.userMessage).toContain(ANTHROPIC_STATUS_URL)
  })

  it('classifies 503/500/502/504 as overloaded', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyAiError(apiError(status)).kind).toBe('overloaded')
    }
  })

  it('classifies 429 as rate_limit', () => {
    const info = classifyAiError(apiError(429))
    expect(info.isProviderIssue).toBe(true)
    expect(info.kind).toBe('rate_limit')
  })

  it('classifies 401/403 as an auth/config issue (no "try again" guidance)', () => {
    const info = classifyAiError(apiError(401))
    expect(info.kind).toBe('auth')
    expect(info.userMessage).toMatch(/configuration issue/i)
  })

  it('falls back to isRetryable when the status is unmapped', () => {
    expect(classifyAiError(apiError(408, { isRetryable: true })).kind).toBe('timeout')
  })
})

describe('classifyAiError — message + network heuristics', () => {
  it('detects "overloaded" in a plain error message', () => {
    expect(classifyAiError(new Error('Overloaded')).kind).toBe('overloaded')
  })

  it('detects network drops as timeouts', () => {
    expect(classifyAiError(new Error('fetch failed')).kind).toBe('timeout')
    expect(classifyAiError(new Error('read ECONNRESET')).kind).toBe('timeout')
  })

  it('unwraps a provider error nested in .cause', () => {
    const wrapped = new Error('stream failed')
    ;(wrapped as { cause?: unknown }).cause = apiError(503)
    expect(classifyAiError(wrapped).kind).toBe('overloaded')
  })
})

describe('classifyAiError — non-provider errors', () => {
  it('does not misclassify an ordinary app error', () => {
    const info = classifyAiError(new Error('Cannot read properties of undefined'))
    expect(info.isProviderIssue).toBe(false)
    expect(info.kind).toBe('unknown')
    expect(aiStreamErrorMessage(new Error('boom'))).toBe('The assistant hit an error — please try again.')
  })
})
