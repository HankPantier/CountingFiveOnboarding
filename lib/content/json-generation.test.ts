import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))

import { generateText } from 'ai'
import { generateJson } from './json-generation'

const mockGen = vi.mocked(generateText)

function reply(text: string, finishReason = 'stop') {
  return { text, finishReason, usage: { inputTokens: 10, outputTokens: 20 } } as unknown as Awaited<
    ReturnType<typeof generateText>
  >
}

const base = { model: 'm' as unknown as Parameters<typeof generateText>[0]['model'], prompt: 'p', label: 't' }

beforeEach(() => {
  mockGen.mockReset()
})

describe('generateJson', () => {
  it('parses prose-wrapped JSON', async () => {
    mockGen.mockResolvedValueOnce(reply('Here you go:\n{"a":1}\nthanks'))
    expect(await generateJson({ ...base, firstBudget: 1000 })).toEqual({ a: 1 })
    expect(mockGen).toHaveBeenCalledTimes(1)
  })

  it('parses fenced JSON', async () => {
    mockGen.mockResolvedValueOnce(reply('```json\n{"a":2}\n```'))
    expect(await generateJson({ ...base, firstBudget: 1000 })).toEqual({ a: 2 })
  })

  it('retries with the larger budget when the first response is truncated', async () => {
    mockGen.mockResolvedValueOnce(reply('{"a":1', 'length')).mockResolvedValueOnce(reply('{"a":3}'))
    const res = await generateJson({ ...base, firstBudget: 1000, retryBudget: 2000 })
    expect(res).toEqual({ a: 3 })
    expect(mockGen).toHaveBeenCalledTimes(2)
    expect(mockGen.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 1000 })
    expect(mockGen.mock.calls[1][0]).toMatchObject({ maxOutputTokens: 2000 })
  })

  it('returns null when both attempts are unparseable (never throws)', async () => {
    mockGen.mockResolvedValue(reply('not json'))
    expect(await generateJson({ ...base, firstBudget: 1000, retryBudget: 2000 })).toBeNull()
    expect(mockGen).toHaveBeenCalledTimes(2)
  })

  it('makes only one call when no retryBudget is given', async () => {
    mockGen.mockResolvedValue(reply('not json'))
    expect(await generateJson({ ...base, firstBudget: 1000 })).toBeNull()
    expect(mockGen).toHaveBeenCalledTimes(1)
  })

  it('recovers when the model throws on the first attempt but succeeds on retry', async () => {
    mockGen.mockRejectedValueOnce(new Error('529 overloaded')).mockResolvedValueOnce(reply('{"a":4}'))
    expect(await generateJson({ ...base, firstBudget: 1000, retryBudget: 2000 })).toEqual({ a: 4 })
  })

  it('returns null (never throws) when the model throws on every attempt', async () => {
    mockGen.mockRejectedValue(new Error('down'))
    expect(await generateJson({ ...base, firstBudget: 1000, retryBudget: 2000 })).toBeNull()
  })

  it('always sends maxRetries and omits providerOptions unless provided (Haiku-safe)', async () => {
    mockGen.mockResolvedValueOnce(reply('{"a":1}'))
    await generateJson({ ...base, firstBudget: 1000 })
    expect(mockGen.mock.calls[0][0]).toMatchObject({ maxRetries: 4 })
    expect(mockGen.mock.calls[0][0].providerOptions).toBeUndefined()
  })

  it('passes providerOptions through when supplied (non-Haiku)', async () => {
    mockGen.mockResolvedValueOnce(reply('{"a":1}'))
    const providerOptions = { anthropic: { effort: 'high' } } as unknown as Parameters<
      typeof generateText
    >[0]['providerOptions']
    await generateJson({ ...base, firstBudget: 1000, providerOptions })
    expect(mockGen.mock.calls[0][0]).toMatchObject({ providerOptions })
  })

  it('invokes onAttempt with usage, and an onAttempt error never fails the result', async () => {
    mockGen.mockResolvedValueOnce(reply('{"a":1}'))
    const onAttempt = vi.fn(() => {
      throw new Error('token recording failed')
    })
    const res = await generateJson({ ...base, firstBudget: 1000, onAttempt })
    expect(res).toEqual({ a: 1 })
    expect(onAttempt).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 20 }, 'stop')
  })
})
