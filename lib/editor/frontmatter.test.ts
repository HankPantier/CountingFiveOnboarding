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

describe('frontmatter parser — multi-line YAML passthrough', () => {
  it('round-trips a block list (tags:\\n  - a) byte-identically', () => {
    const file = `---\ntitle: Post\ntags:\n  - a\n  - b\nurl: /resources/post\n---\nBody`
    const parsed = splitFile(file)
    expect(parsed.frontmatter?.fields['title']).toBe('Post')
    expect(parsed.frontmatter?.fields['url']).toBe('/resources/post')
    // Continuation lines are not mis-read as keys.
    expect(parsed.frontmatter?.order).toEqual(['title', 'tags', 'url'])
    expect(serializeFile(parsed)).toBe(file)
  })

  it('round-trips a folded block scalar with an interior blank line', () => {
    const file = `---\ndescription: >-\n  First line\n\n  second para\ntitle: T\n---\nBody`
    const parsed = splitFile(file)
    expect(serializeFile(parsed)).toBe(file)
  })

  it('keeps block lines when another field is edited', () => {
    const file = `---\ntitle: Old\ntags:\n  - a\n---\nBody`
    const parsed = splitFile(file)
    parsed.frontmatter!.fields['title'] = 'New'
    expect(serializeFile(parsed)).toBe(`---\ntitle: New\ntags:\n  - a\n---\nBody`)
  })

  it('drops the stale block when the editor replaces that key with a scalar', () => {
    const file = `---\ntags:\n  - a\n  - b\n---\nBody`
    const parsed = splitFile(file)
    parsed.frontmatter!.fields['tags'] = 'x'
    expect(serializeFile(parsed)).toBe(`---\ntags: x\n---\nBody`)
  })

  it('preserves leading comment lines', () => {
    const file = `---\n# generated\ntitle: T\n---\nBody`
    expect(serializeFile(splitFile(file))).toBe(file)
  })

  it('does not treat an indented "key: value" as a top-level field', () => {
    const file = `---\nauthor:\n  name: Jane\n  role: CPA\ntitle: T\n---\nB`
    const parsed = splitFile(file)
    expect(parsed.frontmatter?.fields['name']).toBeUndefined()
    expect(serializeFile(parsed)).toBe(file)
  })
})
