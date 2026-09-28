import { describe, it, expect } from 'vitest'
import { VALID } from './__fixtures__/valid-bundle'
import { categoricalDifferences, distinctnessReport, findNearDuplicates, isNearDuplicate, paletteDistance } from './distinctness'

const OXBLOOD = { ...VALID, palette: { ...VALID.palette, primary: '#5c1a2b', action: '#e0a526' } }
const SAME_PALETTE_NEW_LEVERS = {
  ...VALID,
  tokens: { ...VALID.tokens, roundness: 'sharp' as const, density: 'airy' as const },
}

describe('distinctness', () => {
  it('identical bundles are near-duplicates', () => {
    expect(paletteDistance(VALID.palette, VALID.palette)).toBe(0)
    expect(isNearDuplicate(VALID, { ...VALID, name: 'Copy' })).toBe(true)
  })
  it('a clearly different primary + action is distinct', () => {
    expect(paletteDistance(VALID.palette, OXBLOOD.palette)).toBeGreaterThan(12)
    expect(isNearDuplicate(VALID, OXBLOOD)).toBe(false)
  })
  it('same palette but two different levers is distinct (palette "keep" runs)', () => {
    expect(categoricalDifferences(VALID, SAME_PALETTE_NEW_LEVERS)).toBe(2)
    expect(isNearDuplicate(VALID, SAME_PALETTE_NEW_LEVERS)).toBe(false)
  })
  it('flags the LATER bundle of each near-duplicate pair', () => {
    expect(findNearDuplicates([VALID, OXBLOOD, { ...VALID, name: 'Echo' }])).toEqual([{ keep: 0, drop: 2 }])
    expect(findNearDuplicates([VALID, OXBLOOD])).toEqual([])
  })
})

describe('distinctnessReport', () => {
  it('reports ΔE (primary + action) and lever differences against each labelled bundle', () => {
    const other = { ...VALID, palette: { ...VALID.palette, primary: '#5c1a2b' }, tokens: { ...VALID.tokens, roundness: 'sharp' as const } }
    const rows = distinctnessReport(VALID, [
      { label: 'the current site', bundle: VALID },
      { label: 'concept 2', bundle: other },
    ])
    expect(rows[0]).toEqual({ label: 'the current site', deltaE: 0, leverDifferences: 0 })
    expect(rows[1].label).toBe('concept 2')
    expect(rows[1].deltaE).toBeGreaterThan(10)
    expect(rows[1].leverDifferences).toBe(1)
  })
})

describe('layout presets as ONE categorical lever (2026.09.9)', () => {
  it('any layout difference counts once; absent ≡ all default; key order never matters', () => {
    expect(categoricalDifferences(VALID, { ...VALID, layout: { cards: 'list' } })).toBe(1)
    expect(categoricalDifferences(VALID, { ...VALID, layout: { cards: 'list', faq: 'split', team: 'list' } })).toBe(1)
    expect(categoricalDifferences({ ...VALID, layout: { faq: 'split', cards: 'list' } }, { ...VALID, layout: { cards: 'list', faq: 'split' } })).toBe(0)
    expect(categoricalDifferences({ ...VALID, layout: { cards: 'list' } }, { ...VALID, layout: { faq: 'split' } })).toBe(1)
  })
})
