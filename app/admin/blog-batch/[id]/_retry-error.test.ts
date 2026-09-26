import { describe, expect, it } from 'vitest'
import { retryErrorMessage } from './_retry-error'

describe('retryErrorMessage', () => {
  it('surfaces the server message on a 409 (all selected drafts still in flight)', () => {
    expect(
      retryErrorMessage(409, { error: 'These articles are still being drafted — retry once they finish.' })
    ).toBe('These articles are still being drafted — retry once they finish.')
  })

  it('surfaces the server message for other 4xx statuses', () => {
    expect(retryErrorMessage(403, { error: 'Forbidden' })).toBe('Forbidden')
    expect(retryErrorMessage(400, { error: 'Invalid batch id' })).toBe('Invalid batch id')
  })

  it('returns null for a 2xx response', () => {
    expect(retryErrorMessage(200, { retried: 1 })).toBeNull()
  })

  it('returns null for a 5xx response (internalError bodies are not surfaced verbatim here)', () => {
    expect(retryErrorMessage(500, { error: 'Could not reset the drafts for retry' })).toBeNull()
  })

  it('returns null when the body has no string error field', () => {
    expect(retryErrorMessage(409, {})).toBeNull()
    expect(retryErrorMessage(409, null)).toBeNull()
    expect(retryErrorMessage(409, { error: 42 })).toBeNull()
    expect(retryErrorMessage(409, 'plain text')).toBeNull()
  })
})
