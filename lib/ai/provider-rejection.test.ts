import { describe, expect, it } from 'vitest'
import { APICallError, LoadAPIKeyError, RetryError } from 'ai'
import { classifyProviderError, providerRejection, requestWasRejected } from './provider-rejection'

// The exact production message (run c2f78f3d, 2026-09-27).
const USAGE_LIMIT = 'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.'

function apiError(statusCode: number | undefined, message: string, responseBody = '', isRetryable?: boolean) {
  return new APICallError({
    message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    responseBody,
    ...(isRetryable === undefined ? {} : { isRetryable }),
  })
}
const body = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } })

describe('classifyProviderError — account-level rejections', () => {
  it('recognises the usage-limit 400 and extracts the reset date', () => {
    const e = apiError(400, USAGE_LIMIT, body('invalid_request_error', USAGE_LIMIT))
    expect(classifyProviderError(e)).toEqual({ class: 'rejected', kind: 'usage_limit', resetDate: '2026-10-01' })
  })

  it('recognises a usage limit even from the body alone, or behind a 429', () => {
    expect(providerRejection(apiError(400, 'Bad Request', body('invalid_request_error', USAGE_LIMIT)))?.kind).toBe('usage_limit')
    expect(providerRejection(apiError(429, USAGE_LIMIT))).toEqual({ kind: 'usage_limit', resetDate: '2026-10-01' })
  })

  it('recognises a usage limit with no date', () => {
    expect(providerRejection(apiError(400, 'You have reached your specified API usage limits.'))).toEqual({ kind: 'usage_limit', resetDate: null })
  })

  it('recognises "credit balance too low" (a 400) and a 402', () => {
    const credit = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
    expect(providerRejection(apiError(400, credit, body('invalid_request_error', credit)))?.kind).toBe('credit')
    expect(providerRejection(apiError(402, 'Payment Required'))?.kind).toBe('credit')
  })

  it('recognises an invalid key (401) and a missing key', () => {
    expect(providerRejection(apiError(401, 'invalid x-api-key', body('authentication_error', 'invalid x-api-key')))?.kind).toBe('auth')
    expect(providerRejection(new LoadAPIKeyError({ message: 'Anthropic API key is missing.' }))?.kind).toBe('auth')
  })

  it('recognises a permission denial (403)', () => {
    const msg = 'Your API key does not have permission to use the specified resource.'
    expect(providerRejection(apiError(403, msg, body('permission_error', msg)))?.kind).toBe('permission')
  })

  it('unwraps a RetryError to its last provider error', () => {
    const e = new RetryError({ message: 'Failed after 2 attempts', reason: 'errorNotRetryable', errors: [apiError(529, 'Overloaded'), apiError(400, USAGE_LIMIT)] })
    expect(providerRejection(e)?.kind).toBe('usage_limit')
  })
})

describe('classifyProviderError — transient and other', () => {
  it('treats 429 / 529 / 5xx / timeouts as transient', () => {
    expect(classifyProviderError(apiError(429, 'Number of request tokens has exceeded your per-minute rate limit'))).toEqual({ class: 'transient' })
    expect(classifyProviderError(apiError(529, 'Overloaded', body('overloaded_error', 'Overloaded')))).toEqual({ class: 'transient' })
    expect(classifyProviderError(apiError(500, 'Internal server error'))).toEqual({ class: 'transient' })
    expect(classifyProviderError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toEqual({ class: 'transient' })
    expect(classifyProviderError(new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(529, 'Overloaded')] }))).toEqual({ class: 'transient' })
  })

  it('treats a plain bad request, an app error and unparseable output as other', () => {
    expect(classifyProviderError(apiError(400, 'prompt is too long: 250000 tokens > 200000 maximum'))).toEqual({ class: 'other' })
    expect(classifyProviderError(new SyntaxError('Unexpected token'))).toEqual({ class: 'other' })
    expect(classifyProviderError(null)).toEqual({ class: 'other' })
    expect(providerRejection(new Error(USAGE_LIMIT))).toBeNull() // only a provider error object counts
  })
})

describe('requestWasRejected — nothing generated, nothing billed', () => {
  it('is true for an HTTP error response and a missing key', () => {
    expect(requestWasRejected(apiError(400, USAGE_LIMIT))).toBe(true)
    expect(requestWasRejected(apiError(529, 'Overloaded'))).toBe(true)
    expect(requestWasRejected(new LoadAPIKeyError({ message: 'missing' }))).toBe(true)
    expect(requestWasRejected(new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(529, 'a'), apiError(529, 'b')] }))).toBe(true)
  })

  it('is false for a timeout abort, a status-less network failure, or anything unknown', () => {
    expect(requestWasRejected(new DOMException('aborted', 'TimeoutError'))).toBe(false)
    expect(requestWasRejected(apiError(undefined, 'Cannot connect to API: fetch failed', '', true))).toBe(false)
    expect(requestWasRejected(new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(529, 'a'), apiError(undefined, 'fetch failed', '', true)] }))).toBe(false)
    expect(requestWasRejected(new Error('boom'))).toBe(false)
  })
})
