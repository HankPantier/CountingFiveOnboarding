import { describe, expect, it } from 'vitest'
import { unwrapChatErrorMessage } from './ai-error-text'

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
