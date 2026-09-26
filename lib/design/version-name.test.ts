import { describe, it, expect } from 'vitest'
import { BUNDLE_NAME_MAX_LENGTH } from './bundle'
import { deriveChatVersionName, deriveRestoreVersionName, truncateName } from './version-name'

describe('truncateName', () => {
  it('returns short text unchanged', () => {
    expect(truncateName('Calmed hero-split', 60)).toBe('Calmed hero-split')
  })
  it('trims surrounding whitespace even when short', () => {
    expect(truncateName('  Calmed hero-split  ', 60)).toBe('Calmed hero-split')
  })
  it('cuts at a word boundary and adds an ellipsis when over the cap', () => {
    const long = 'Made the hero section calmer and swapped the accent font for something warmer'
    const out = truncateName(long, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out.endsWith('…')).toBe(true)
    expect(out).toBe('Made the hero section calmer…')
  })
  it('hard-cuts when the last space is too early for a word-boundary cut to preserve enough text', () => {
    const long = 'Supercalifragilisticexpialidocious is not a real palette name at all'
    const out = truncateName(long, 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('deriveChatVersionName', () => {
  it('uses the commit summary as the name', () => {
    expect(deriveChatVersionName('Calmed hero-split')).toBe('Calmed hero-split')
  })
  it('truncates a long summary within the bundle name max length', () => {
    const long = 'Rewrote the hero, footer and pricing sections to use the new warmer serif accent throughout'
    const out = deriveChatVersionName(long)
    expect(out.length).toBeLessThanOrEqual(BUNDLE_NAME_MAX_LENGTH)
    expect(out.endsWith('…')).toBe(true)
  })
  it('falls back to a generic label for a blank summary', () => {
    expect(deriveChatVersionName('   ')).toBe('Chat revision')
  })
})

describe('deriveRestoreVersionName', () => {
  it('appends the original name when it fits the cap', () => {
    expect(deriveRestoreVersionName(2, 'Harbor Ledger')).toBe('Restored v2 — Harbor Ledger')
  })
  it('falls back to just "Restored v{k}" when the original name would blow the cap', () => {
    const longName = 'A'.repeat(BUNDLE_NAME_MAX_LENGTH)
    expect(deriveRestoreVersionName(12, longName)).toBe('Restored v12')
  })
  it('falls back to just "Restored v{k}" for a blank original name', () => {
    expect(deriveRestoreVersionName(3, '   ')).toBe('Restored v3')
  })
  it('never exceeds the bundle name max length', () => {
    const longName = 'B'.repeat(BUNDLE_NAME_MAX_LENGTH)
    expect(deriveRestoreVersionName(999, longName).length).toBeLessThanOrEqual(BUNDLE_NAME_MAX_LENGTH)
  })
})
