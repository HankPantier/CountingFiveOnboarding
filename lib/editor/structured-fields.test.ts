import { describe, expect, it } from 'vitest'
import { splitFile, serializeFile, type Frontmatter } from './frontmatter'
import {
  getFaqBlock,
  setFaqBlock,
  getInternalLinks,
  setInternalLinks,
  getEeatSignals,
  setEeatSignals,
  getAnswerBlock,
  setAnswerBlock,
} from './structured-fields'

function fm(body: string): Frontmatter {
  const parsed = splitFile(`---\n${body}\n---\nX`)
  if (!parsed.frontmatter) throw new Error('no frontmatter')
  return parsed.frontmatter
}

describe('faq_block', () => {
  it('reads JSON array of {question, answer}', () => {
    const f = fm('faq_block: [{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2"}]')
    expect(getFaqBlock(f)).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ])
  })

  it('round-trips through set, preserving commas/quotes in content', () => {
    const f = setFaqBlock(fm('title: T'), [
      { question: 'Is "S-corp" right, or LLC?', answer: 'It depends.' },
    ])
    expect(getFaqBlock(f)).toEqual([
      { question: 'Is "S-corp" right, or LLC?', answer: 'It depends.' },
    ])
  })

  it('drops the field entirely when emptied', () => {
    const f = setFaqBlock(fm('faq_block: [{"question":"Q","answer":"A"}]'), [])
    expect(f.fields['faq_block']).toBeUndefined()
    expect(f.order).not.toContain('faq_block')
  })

  it('skips blank rows on set', () => {
    const f = setFaqBlock(fm('title: T'), [
      { question: '', answer: '' },
      { question: 'Q', answer: 'A' },
    ])
    expect(getFaqBlock(f)).toEqual([{ question: 'Q', answer: 'A' }])
  })
})

describe('internal_links', () => {
  it('reads and writes {url, anchor_text, reason}', () => {
    const link = { url: '/services/tax', anchor_text: 'tax services', reason: 'topical' }
    const f = setInternalLinks(fm('title: T'), [link])
    expect(getInternalLinks(f)).toEqual([link])
  })
})

describe('eeat_signals', () => {
  it('reads JSON string array', () => {
    expect(getEeatSignals(fm('eeat_signals: ["Licensed CPA","PFS"]'))).toEqual([
      'Licensed CPA',
      'PFS',
    ])
  })

  it('also reads a legacy bare inline array', () => {
    expect(getEeatSignals(fm('eeat_signals: [Licensed CPA, PFS]'))).toEqual([
      'Licensed CPA',
      'PFS',
    ])
  })

  it('writes JSON and trims blanks', () => {
    const f = setEeatSignals(fm('title: T'), ['Licensed CPA', '  ', 'PFS'])
    expect(f.fields['eeat_signals']).toBe('["Licensed CPA","PFS"]')
  })
})

describe('answer_block', () => {
  it('reads a JSON-quoted scalar', () => {
    expect(getAnswerBlock(fm('answer_block: "A direct answer."'))).toBe('A direct answer.')
  })

  it('reads a bare scalar (legacy)', () => {
    expect(getAnswerBlock(fm('answer_block: A direct answer'))).toBe('A direct answer')
  })

  it('writes JSON and serializes to a single line', () => {
    const f = setAnswerBlock(fm('title: T'), 'Multi: word, answer.')
    const out = serializeFile({ frontmatter: f, body: 'X' })
    expect(out).toContain('answer_block: "Multi: word, answer."')
    expect(getAnswerBlock(f)).toBe('Multi: word, answer.')
  })
})
