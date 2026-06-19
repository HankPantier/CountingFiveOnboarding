import { describe, expect, it } from 'vitest'
import {
  parseAnswerOutput,
  parseEeatOutput,
  parseFaqOutput,
  parseLinksOutput,
  isSeoField,
} from './seo-field-generator'

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
