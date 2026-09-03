import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn((id: string) => id) }))

import { generateText } from 'ai'
import {
  parseAnswerOutput,
  parseEeatOutput,
  parseFaqOutput,
  parseLinksOutput,
  isSeoField,
  generateSeoField,
} from './seo-field-generator'
import type { SessionSchema } from '@/types/session-schema'

const mockGen = vi.mocked(generateText)
function reply(text: string) {
  return { text, finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 20 } } as unknown as Awaited<
    ReturnType<typeof generateText>
  >
}
const seoArgs = (field: 'answer' | 'faq' | 'eeat' | 'links', over: Record<string, unknown> = {}) => ({
  field,
  pageTitle: 'Tax Services',
  pageUrl: '/services/tax',
  pageContent: 'We prepare and file taxes.',
  schema: {} as SessionSchema,
  sitemapUrls: ['/services', '/about'],
  ...over,
})

describe('isSeoField', () => {
  it('accepts the four field names and rejects others', () => {
    expect(isSeoField('faq')).toBe(true)
    expect(isSeoField('links')).toBe(true)
    expect(isSeoField('nope')).toBe(false)
    expect(isSeoField(undefined)).toBe(false)
  })
})

describe('parseAnswerOutput', () => {
  it('extracts answer_block from plain JSON', () => {
    expect(parseAnswerOutput('{"answer_block": "We file year-round."}')).toBe('We file year-round.')
  })

  it('tolerates ```json fences and surrounding prose', () => {
    const text = 'Here you go:\n```json\n{"answer_block": "Direct answer."}\n```'
    expect(parseAnswerOutput(text)).toBe('Direct answer.')
  })

  it('returns empty string when the key is missing', () => {
    expect(parseAnswerOutput('{"something_else": 1}')).toBe('')
  })

  it('throws when there is no JSON at all', () => {
    expect(() => parseAnswerOutput('no json here')).toThrow()
  })
})

describe('parseFaqOutput', () => {
  it('parses valid Q&A and drops malformed/blank entries', () => {
    const text = JSON.stringify({
      faq_block: [
        { question: 'Q1?', answer: 'A1.' },
        { question: 'Q2?' }, // missing answer
        { question: '', answer: '' }, // blank
      ],
    })
    expect(parseFaqOutput(text)).toEqual([{ question: 'Q1?', answer: 'A1.' }])
  })

  it('returns [] when faq_block is not an array', () => {
    expect(parseFaqOutput('{"faq_block": "oops"}')).toEqual([])
  })
})

describe('parseEeatOutput', () => {
  it('parses string array and trims blanks', () => {
    expect(parseEeatOutput('{"eeat_signals": ["Licensed CPA", "  ", "PFS"]}')).toEqual([
      'Licensed CPA',
      'PFS',
    ])
  })
})

describe('generateSeoField — strips AI dash-tells from visible output', () => {
  beforeEach(() => mockGen.mockReset())

  it('sanitizes the answer_block', async () => {
    mockGen.mockResolvedValueOnce(reply('{"answer_block": "We file fast — and accurately."}'))
    const { result } = await generateSeoField(seoArgs('answer'))
    expect(result.value).toBe('We file fast, and accurately.')
  })

  it('sanitizes FAQ questions and answers', async () => {
    mockGen.mockResolvedValueOnce(
      reply('{"faq_block": [{"question": "When — really?", "answer": "Year-round — always."}]}')
    )
    const { result } = await generateSeoField(seoArgs('faq'))
    expect(result.value).toEqual([{ question: 'When, really?', answer: 'Year-round, always.' }])
  })

  it('sanitizes E-E-A-T signals', async () => {
    mockGen.mockResolvedValueOnce(reply('{"eeat_signals": ["Licensed CPA — since 2005"]}'))
    const { result } = await generateSeoField(seoArgs('eeat'))
    expect(result.value).toEqual(['Licensed CPA, since 2005'])
  })

  it('sanitizes internal-link anchor text (url and reason untouched)', async () => {
    mockGen.mockResolvedValueOnce(
      reply('{"internal_links": [{"url": "/services", "anchor_text": "our services — here", "reason": "r"}]}')
    )
    const { result } = await generateSeoField(seoArgs('links', { pageUrl: '/about' }))
    expect(result.value).toEqual([{ url: '/services', anchor_text: 'our services, here', reason: 'r' }])
  })
})

describe('parseLinksOutput', () => {
  const allowed = ['/services', '/services/tax', '/about']

  it('keeps only allowlisted URLs and excludes the self URL', () => {
    const text = JSON.stringify({
      internal_links: [
        { url: '/services/tax', anchor_text: 'tax', reason: 'related' },
        { url: '/invented', anchor_text: 'x', reason: 'y' }, // not allowed
        { url: '/about', anchor_text: 'about', reason: 'company' },
      ],
    })
    expect(parseLinksOutput(text, allowed, '/about')).toEqual([
      { url: '/services/tax', anchor_text: 'tax', reason: 'related' },
    ])
  })

  it('matches regardless of trailing slash', () => {
    const text = JSON.stringify({
      internal_links: [{ url: '/services/', anchor_text: 'services', reason: 'parent' }],
    })
    expect(parseLinksOutput(text, allowed, '/contact')).toEqual([
      { url: '/services/', anchor_text: 'services', reason: 'parent' },
    ])
  })
})
