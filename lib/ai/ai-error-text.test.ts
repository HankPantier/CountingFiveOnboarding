import { describe, expect, it } from 'vitest'
import { aiErrorKindFromText, aiErrorMessageFor, classifyAiErrorText, isProviderIssueKind, unwrapChatErrorMessage, usageLimitResetDate } from './ai-error-text'

describe('unwrapChatErrorMessage', () => {
  it('unwraps a JSON { error } body (e.g. the chat spend-limit 429)', () => {
    const body = JSON.stringify({ error: "You've reached today's AI editing limit. Please try again tomorrow." })
    expect(unwrapChatErrorMessage(body)).toBe("You've reached today's AI editing limit. Please try again tomorrow.")
  })

  it('passes plain text through unchanged', () => {
    expect(unwrapChatErrorMessage('The assistant hit an unexpected error')).toBe(
      'The assistant hit an unexpected error'
    )
  })

  it('falls back to the original string on malformed JSON', () => {
    const malformed = '{ "error": "unterminated'
    expect(unwrapChatErrorMessage(malformed)).toBe(malformed)
  })

  it('falls back when the JSON body has no string error field', () => {
    const body = JSON.stringify({ code: 500 })
    expect(unwrapChatErrorMessage(body)).toBe(body)
  })

  it('tolerates leading/trailing whitespace around the JSON body', () => {
    const body = `  ${JSON.stringify({ error: 'Server misconfigured' })}  `
    expect(unwrapChatErrorMessage(body)).toBe('Server misconfigured')
  })
})

describe('usage-limit text', () => {
  const USAGE_LIMIT = 'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.'

  it('classifies the provider message (also inside a stored error / JSON body) as usage_limit', () => {
    expect(aiErrorKindFromText(USAGE_LIMIT)).toBe('usage_limit')
    expect(aiErrorKindFromText(`AI_APICallError: ${USAGE_LIMIT}`)).toBe('usage_limit')
    expect(aiErrorKindFromText(JSON.stringify({ error: { type: 'invalid_request_error', message: USAGE_LIMIT } }))).toBe('usage_limit')
  })

  it('does not confuse it with a rate limit or a long prompt', () => {
    expect(aiErrorKindFromText('rate limit exceeded')).toBe('rate_limit')
    expect(aiErrorKindFromText('prompt is too long')).toBe('bad_request')
  })

  it('extracts the reset date and puts it in the stored-error message', () => {
    expect(usageLimitResetDate(USAGE_LIMIT)).toBe('2026-10-01')
    expect(usageLimitResetDate('no date here')).toBeNull()
    const info = classifyAiErrorText(USAGE_LIMIT)
    expect(info.kind).toBe('usage_limit')
    expect(info.userMessage).toContain('(access returns 2026-10-01)')
  })
})

describe('credit 402 anchoring + isProviderIssue agreement', () => {
  it('a bare 402 in unrelated text is not a credit error; 402 with payment/credit wording is', () => {
    expect(aiErrorKindFromText('messages.402: text content blocks must be non-empty')).not.toBe('credit')
    expect(aiErrorKindFromText('402 Payment Required')).toBe('credit')
    expect(aiErrorKindFromText('HTTP 402 — credit exhausted')).toBe('credit')
  })

  it('classifyAiErrorText and isProviderIssueKind agree for every recognised kind', () => {
    for (const text of ['Overloaded', 'rate limit', 'fetch failed', 'invalid api key', 'Your credit balance is too low', 'You have reached your specified API usage limits.']) {
      const info = classifyAiErrorText(text)
      expect(isProviderIssueKind(info.kind)).toBe(info.isProviderIssue)
    }
    expect(isProviderIssueKind('usage_limit')).toBe(true)
    expect(isProviderIssueKind('credit')).toBe(true)
    expect(aiErrorMessageFor('usage_limit')).toMatch(/usage limit/)
  })
})
