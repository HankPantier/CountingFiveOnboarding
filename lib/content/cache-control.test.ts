import { describe, it, expect } from 'vitest'
import { buildCachedMessages, extractCacheUsage } from './cache-control'
import { chatProviderOptions, FAST_CHAT_PROVIDER_OPTIONS } from './generation-tuning'

type TextPart = { type: 'text'; text: string; providerOptions?: { anthropic?: { cacheControl?: unknown } } }

function parts(ttl?: '5m' | '1h'): TextPart[] {
  const [msg] = buildCachedMessages('STATIC', 'DYNAMIC', ttl)
  return msg.content as TextPart[]
}

describe('buildCachedMessages', () => {
  it('marks only the static prefix with a 5m breakpoint by default', () => {
    const [prefix, suffix] = parts()
    expect(prefix.text).toBe('STATIC')
    expect(prefix.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    expect(suffix.text).toBe('DYNAMIC')
    expect(suffix.providerOptions).toBeUndefined()
  })

  it('uses a 1h TTL when asked', () => {
    expect(parts('1h')[0].providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' })
  })
})

describe('chat provider options', () => {
  it('turns on automatic caching alongside effort for Sonnet chats', () => {
    expect(chatProviderOptions('low').anthropic).toMatchObject({
      effort: 'low',
      cacheControl: { type: 'ephemeral' },
    })
  })

  it('gives the Haiku branch caching but never effort or thinking', () => {
    expect(FAST_CHAT_PROVIDER_OPTIONS.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } })
  })
})

describe('extractCacheUsage', () => {
  it('reads the SDK cache split and defaults to zero', () => {
    expect(
      extractCacheUsage({
        inputTokens: 100,
        inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 10 },
        outputTokens: 5,
        outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
        totalTokens: 105,
      }),
    ).toEqual({ cacheReadInputTokens: 80, cacheCreationInputTokens: 10 })
    expect(extractCacheUsage(undefined)).toEqual({ cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })
  })
})
