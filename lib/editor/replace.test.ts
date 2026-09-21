import { describe, expect, it } from 'vitest'
import { overlapSafeReplaceAll } from './replace'

const FIND = 'service business'
const REPLACE = 'professional service business'
const SENTENCE = 'Farm and service business owners across the Brookings, SD area.'
const WRAPPED = 'Farm and professional service business owners across the Brookings, SD area.'

describe('overlapSafeReplaceAll', () => {
  it('wraps a bare occurrence once', () => {
    expect(overlapSafeReplaceAll(SENTENCE, FIND, REPLACE)).toBe(WRAPPED)
  })

  it('is idempotent for a self-referential (wrapping) replacement', () => {
    // The bug: replacement contains the find term, so a naive replace-all
    // compounds every pass. Applying 1x, 2x, and 4x must all yield ONE wrap.
    let once = overlapSafeReplaceAll(SENTENCE, FIND, REPLACE)
    let twice = overlapSafeReplaceAll(once, FIND, REPLACE)
    let quad = overlapSafeReplaceAll(
      overlapSafeReplaceAll(twice, FIND, REPLACE),
      FIND,
      REPLACE
    )
    expect(once).toBe(WRAPPED)
    expect(twice).toBe(WRAPPED)
    expect(quad).toBe(WRAPPED)
    expect((quad.match(/professional/g) || []).length).toBe(1)
  })

  it('does not re-wrap text that already contains the full replacement', () => {
    expect(overlapSafeReplaceAll(WRAPPED, FIND, REPLACE)).toBe(WRAPPED)
  })

  it('wraps every bare occurrence globally while leaving already-wrapped ones intact', () => {
    const mixed = 'A service business and a professional service business.'
    const out = overlapSafeReplaceAll(mixed, FIND, REPLACE)
    expect(out).toBe('A professional service business and a professional service business.')
    // idempotent on the mixed input too
    expect(overlapSafeReplaceAll(out, FIND, REPLACE)).toBe(out)
  })

  it('is idempotent for the case-insensitive path', () => {
    const mixed = 'Service Business and professional service business'
    const once = overlapSafeReplaceAll(mixed, FIND, REPLACE, true)
    const twice = overlapSafeReplaceAll(once, FIND, REPLACE, true)
    expect(once.toLowerCase()).toBe('professional service business and professional service business')
    expect(twice).toBe(once)
  })

  it('keeps plain non-overlapping replacements working (and deletions)', () => {
    expect(overlapSafeReplaceAll('the old brand X', 'old brand', 'firm')).toBe('the firm X')
    expect(overlapSafeReplaceAll('drop me please', 'drop me ', '')).toBe('please')
  })

  it('inserts the replacement verbatim without regex substitution artifacts', () => {
    expect(overlapSafeReplaceAll('cost is PRICE', 'PRICE', '$40 (net)')).toBe('cost is $40 (net)')
    expect(overlapSafeReplaceAll('cost is price', 'PRICE', '$40 (net)', true)).toBe('cost is $40 (net)')
  })

  it('returns the input unchanged for an empty find', () => {
    expect(overlapSafeReplaceAll('anything', '', 'x')).toBe('anything')
  })
})
