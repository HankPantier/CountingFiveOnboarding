import { describe, expect, it } from 'vitest'
import { splitFile, serializeFile } from './frontmatter'

describe('frontmatter parser — complex value safety', () => {
  it('preserves a JSON array-of-objects field verbatim (no comma-split)', () => {
    const faq = '[{"question":"Q1, with comma","answer":"A1"},{"question":"Q2","answer":"A2"}]'
    const file = `---\ntitle: Services\nfaq_block: ${faq}\n---\nBody`
    const parsed = splitFile(file)
    expect(parsed.frontmatter?.fields['faq_block']).toBe(faq)
    expect(parsed.frontmatter?.arrayFields['faq_block']).toBeUndefined()
    // Round-trips byte-identically.
    expect(serializeFile(parsed)).toBe(file)
  })

  it('preserves a JSON string-array (quoted) verbatim', () => {
    const eeat = '["Licensed CPA","30+ years, multi-state","PFS credential"]'
    const file = `---\neeat_signals: ${eeat}\n---\nBody`
    const parsed = splitFile(file)
    expect(parsed.frontmatter?.fields['eeat_signals']).toBe(eeat)
    expect(serializeFile(parsed)).toBe(file)
  })

  it('still parses a bare scalar inline array (secondary_keywords)', () => {
    const file = `---\nsecondary_keywords: [cpa firm, tax planning, bookkeeping]\n---\nBody`
    const parsed = splitFile(file)
    expect(parsed.frontmatter?.arrayFields['secondary_keywords']).toEqual([
      'cpa firm',
      'tax planning',
      'bookkeeping',
    ])
  })

  it('preserves a JSON-quoted scalar (answer_block) verbatim', () => {
    const file = `---\nanswer_block: "Korbey Lague helps: tax, books, advisory."\n---\nBody`
    const parsed = splitFile(file)
    expect(parsed.frontmatter?.fields['answer_block']).toBe(
      '"Korbey Lague helps: tax, books, advisory."'
    )
    expect(serializeFile(parsed)).toBe(file)
  })
})
