import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn((id: string) => id) }))
vi.mock('./token-usage', () => ({ recordTokenUsage: vi.fn(async () => {}) }))
vi.mock('./no-go-phrases', () => ({ loadNoGoPhrases: vi.fn(async () => []), buildNoGoPromptBlock: () => '' }))

import { generateText } from 'ai'
import { generateSocialJson } from './social-generator'
import { checkBrandFit } from './brand-fit'
import { generateSeoField } from './seo-field-generator'

const mockGen = vi.mocked(generateText)

function reply(text: string, finishReason = 'stop') {
  return { text, finishReason, usage: { inputTokens: 10, outputTokens: 10 } } as unknown as Awaited<
    ReturnType<typeof generateText>
  >
}

function lastCall() {
  return mockGen.mock.calls[mockGen.mock.calls.length - 1][0] as unknown as { abortSignal?: AbortSignal }
}

beforeEach(() => mockGen.mockReset())

// Every model call that runs while a row is claimed (social_status 'running',
// an article import 'drafting', a draft 'running') or on a request path must
// carry an abort signal, or a stalled provider holds the row until the
// function is killed and the 10-15 min sweep notices.
describe('model calls carry an abort signal', () => {
  it('social suggestions', async () => {
    mockGen.mockResolvedValue(reply(JSON.stringify({ linkedin: 'a', twitter: 'b', facebook: 'c' })))
    await generateSocialJson({
      schema: {}, title: 't', excerpt: 'e', answerBlock: 'a', body: 'b',
      canonicalUrl: 'https://x.test/resources/t', contentJobId: 'j', sessionId: 's', slug: 't',
    })
    expect(lastCall().abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('social skips its retry when the deadline is too close', async () => {
    mockGen.mockResolvedValue(reply('not json', 'length'))
    const res = await generateSocialJson({
      schema: {}, title: 't', excerpt: 'e', answerBlock: 'a', body: 'b',
      canonicalUrl: 'https://x.test/resources/t', contentJobId: 'j', sessionId: 's', slug: 't',
      deadlineAt: Date.now() + 5_000,
    })
    expect(res).toBeNull()
    expect(mockGen).toHaveBeenCalledTimes(1)
  })

  it('brand-fit check', async () => {
    mockGen.mockResolvedValue(reply(JSON.stringify({ fit: 'on-brand', conflicts: [], proposedAmendment: null })))
    await checkBrandFit({ text: 'write about taxes', schema: {}, contentJobId: 'j', sessionId: 's' })
    expect(lastCall().abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('SEO field generation', async () => {
    mockGen.mockResolvedValue(reply(JSON.stringify({ answer_block: 'x' })))
    await generateSeoField({
      field: 'answer', pageTitle: 'p', pageUrl: '/p', pageContent: 'body', schema: {}, sitemapUrls: [],
    }).catch(() => undefined)
    expect(lastCall().abortSignal).toBeInstanceOf(AbortSignal)
  })
})
