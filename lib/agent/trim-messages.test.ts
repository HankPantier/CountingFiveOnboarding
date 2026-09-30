import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { trimMessages } from './trim-messages'

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] })

describe('trimMessages', () => {
  it('strips reasoning parts and keeps text and tool parts', () => {
    const assistant: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'thinking', providerMetadata: { anthropic: { signature: 'sig' } } },
        { type: 'text', text: 'Done.' },
        { type: 'dynamic-tool', toolName: 'apply_edits', toolCallId: 't1', state: 'output-available', input: {}, output: { ok: true } },
      ],
    }
    const [, out] = trimMessages([user('u1', 'hi'), assistant, user('u2', 'next')])
    expect(out.parts.map((p) => p.type)).toEqual(['text', 'dynamic-tool'])
  })

  it('drops an assistant message that held only reasoning', () => {
    const onlyReasoning: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'reasoning', text: 'x' }] }
    const out = trimMessages([user('u1', 'hi'), onlyReasoning, user('u2', 'next')])
    expect(out.map((m) => m.id)).toEqual(['u1', 'u2'])
  })

  it('returns messages without reasoning unchanged', () => {
    const msgs = [user('u1', 'a'), user('u2', 'b')]
    expect(trimMessages(msgs)).toEqual(msgs)
  })

  it('keeps the first message plus the most recent 19 when over the cap', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => user(`u${i}`, String(i)))
    const out = trimMessages(msgs)
    expect(out).toHaveLength(20)
    expect(out[0].id).toBe('u0')
    expect(out[1].id).toBe('u6')
  })
})
