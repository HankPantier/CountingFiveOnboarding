import { describe, expect, it, vi } from 'vitest'
import { APICallError } from 'ai'
import { classifyAiError, aiStreamErrorMessage, logAndFormatAiStreamError, ANTHROPIC_STATUS_URL } from './ai-error'

function apiError(statusCode: number, { message = 'boom', isRetryable = false, responseBody = '' } = {}) {
  return new APICallError({
    message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    isRetryable,
    responseBody,
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

  it('classifies 400/413/422 as a rejected request (not a provider outage)', () => {
    for (const status of [400, 413, 422]) {
      const info = classifyAiError(apiError(status))
      expect(info.kind).toBe('bad_request')
      // A rejected request is NOT a transient provider issue — retrying identically won't help.
      expect(info.isProviderIssue).toBe(false)
      expect(info.userMessage).toMatch(/too long or complex|shorter/i)
    }
  })

  it('classifies out-of-credits as its own kind, even though it arrives as a 400', () => {
    // Anthropic returns insufficient credits as a 400 whose body says the reason.
    const info = classifyAiError(
      apiError(400, {
        message: 'Bad Request',
        responseBody:
          '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
      })
    )
    expect(info.kind).toBe('credit') // NOT bad_request — must not say "shorten your request"
    expect(info.isProviderIssue).toBe(false)
    expect(info.userMessage).toMatch(/credits/i)
    expect(info.userMessage).toMatch(/administrator/i)
    expect(info.userMessage).not.toMatch(/shorter|too long/i)
  })

  it('classifies a 402 Payment Required as a credit issue', () => {
    expect(classifyAiError(apiError(402)).kind).toBe('credit')
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

  it('detects a too-long prompt / invalid request in the message text', () => {
    expect(classifyAiError(new Error('prompt is too long: 210000 tokens')).kind).toBe('bad_request')
    expect(classifyAiError(new Error('invalid_request_error')).kind).toBe('bad_request')
  })

  it('detects an out-of-credits message in plain error text', () => {
    expect(classifyAiError(new Error('Your credit balance is too low to access the Anthropic API')).kind).toBe('credit')
  })
})

describe('classifyAiError — non-provider errors', () => {
  it('does not misclassify an ordinary app error', () => {
    const info = classifyAiError(new Error('Cannot read properties of undefined'))
    expect(info.isProviderIssue).toBe(false)
    expect(info.kind).toBe('unknown')
    expect(aiStreamErrorMessage(new Error('boom'))).toMatch(/unexpected error/i)
  })
})

describe('logAndFormatAiStreamError', () => {
  it('logs an unclassified error at error level and returns the generic message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = logAndFormatAiStreamError('edit-page', new Error('Cannot read properties of undefined'))
    expect(msg).toMatch(/unexpected error/i)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[ai-error] edit-page UNCLASSIFIED')
    spy.mockRestore()
  })

  it('logs a provider issue at warn level and returns its guidance', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const msg = logAndFormatAiStreamError('edit-page', apiError(529))
    expect(msg).toContain(ANTHROPIC_STATUS_URL)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[ai-error] edit-page overloaded')
    spy.mockRestore()
  })
})
