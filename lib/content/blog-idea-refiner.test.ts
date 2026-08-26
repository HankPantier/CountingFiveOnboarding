import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn((id: string) => id) }))
vi.mock('./truncate-to-token-budget', () => ({ checkTokenBudget: vi.fn() }))
vi.mock('./token-usage', () => ({ recordTokenUsage: vi.fn(async () => {}) }))

import { generateText } from 'ai'
import { refineBlogIdea } from './blog-idea-refiner'

const mockGen = vi.mocked(generateText)

const IDEA = {
  title: 'Self-Care Is a Growth Strategy, Not a Luxury',
  angle: 'Reframe wellbeing as a driver of sharper business decisions',
  target_keyword: 'self-care for business owners',
  secondary_keywords: ['owner burnout', 'work-life balance for entrepreneurs'],
  rationale: 'Owners searching for relief convert into higher-trust clients.',
  suggested_external_links: [{ url: 'https://www.sba.gov/', title: 'SBA' }],
}

// Only the fields refineBlogIdea reads off the generateText result.
function reply(text: string, finishReason = 'stop') {
  return { text, finishReason, usage: { inputTokens: 100, outputTokens: 200 } } as unknown as Awaited<
    ReturnType<typeof generateText>
  >
}

beforeEach(() => {
  mockGen.mockReset()
})

describe('refineBlogIdea', () => {
  it('parses prose-wrapped JSON via extractJson', async () => {
    mockGen.mockResolvedValueOnce(reply(`Here's the sharpened idea:\n${JSON.stringify(IDEA)}\nHope that helps!`))
    const res = await refineBlogIdea({ seed: 'self-care for owners' })
    expect(res?.title).toBe(IDEA.title)
    expect(res?.suggested_external_links).toEqual([{ url: 'https://www.sba.gov/', title: 'SBA' }])
    expect(mockGen).toHaveBeenCalledTimes(1)
  })

  it('parses fenced JSON', async () => {
    mockGen.mockResolvedValueOnce(reply('```json\n' + JSON.stringify(IDEA) + '\n```'))
    const res = await refineBlogIdea({ seed: 'self-care for owners' })
    expect(res?.title).toBe(IDEA.title)
  })

  it('retries with a larger budget when the first response is truncated, then recovers', async () => {
    // Truncated (unbalanced) JSON → extractJson throws → retry.
    const truncated = JSON.stringify(IDEA).slice(0, 80)
    mockGen
      .mockResolvedValueOnce(reply(truncated, 'length'))
      .mockResolvedValueOnce(reply(JSON.stringify(IDEA)))
    const res = await refineBlogIdea({ seed: 'self-care for owners' })
    expect(res?.title).toBe(IDEA.title)
    expect(mockGen).toHaveBeenCalledTimes(2)
    // Second call must use the larger budget.
    expect(mockGen.mock.calls[1][0]).toMatchObject({ maxOutputTokens: 4000 })
  })

  it('returns null when both attempts are unparseable', async () => {
    mockGen.mockResolvedValue(reply('not json at all', 'stop'))
    const res = await refineBlogIdea({ seed: 'self-care for owners' })
    expect(res).toBeNull()
    expect(mockGen).toHaveBeenCalledTimes(2)
  })

  it('returns null when the parsed JSON is missing a title', async () => {
    const noTitle = { ...IDEA, title: undefined }
    mockGen.mockResolvedValue(reply(JSON.stringify(noTitle)))
    const res = await refineBlogIdea({ seed: 'self-care for owners' })
    expect(res).toBeNull()
  })
})
