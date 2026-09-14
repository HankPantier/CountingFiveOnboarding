import { describe, expect, it } from 'vitest'
import { normalizeNoGo, findNoGoHits, buildNoGoPromptBlock } from './no-go-match'

describe('normalizeNoGo', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeNoGo('  Receipts   In A\nShoebox ')).toBe('receipts in a shoebox')
  })
})

describe('findNoGoHits', () => {
  const phrases = ['receipts in a shoebox', 'game-changer']

  it('matches case-insensitively and whitespace-tolerantly', () => {
    expect(findNoGoHits('You bring us Receipts in a shoebox.', phrases)).toEqual([
      'receipts in a shoebox',
    ])
    expect(findNoGoHits('receipts  in a\n\nshoebox', phrases)).toEqual(['receipts in a shoebox'])
  })

  it('returns the original phrase spelling, not the normalized form', () => {
    expect(findNoGoHits('a real GAME-CHANGER here', phrases)).toEqual(['game-changer'])
  })

  it('does not match unrelated text', () => {
    expect(findNoGoHits('We organize your records digitally.', phrases)).toEqual([])
  })

  it('is safe on empty inputs', () => {
    expect(findNoGoHits('', phrases)).toEqual([])
    expect(findNoGoHits('anything', [])).toEqual([])
  })
})

describe('buildNoGoPromptBlock', () => {
  it('returns empty string for an empty list (leaves prompts unchanged)', () => {
    expect(buildNoGoPromptBlock([])).toBe('')
    expect(buildNoGoPromptBlock(['   '])).toBe('')
  })

  it('renders a hard-ban block listing each phrase', () => {
    const block = buildNoGoPromptBlock(['receipts in a shoebox'])
    expect(block).toContain('NO-GO PHRASES')
    expect(block).toContain('- "receipts in a shoebox"')
  })
})
