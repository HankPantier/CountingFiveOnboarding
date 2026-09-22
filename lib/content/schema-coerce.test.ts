import { describe, expect, it } from 'vitest'
import { arr, objArr, str } from './schema-coerce'

describe('objArr', () => {
  it('degrades a stringy object-array field to empty (business.serviceAreas)', () => {
    // The Berg session stored serviceAreas as "Nationwide, International", whose
    // truthy .length slipped past an `if (areas.length)` guard and threw on .map.
    expect(objArr('Nationwide, International')).toEqual([])
  })

  it('drops null holes left by a stale-index bracket write', () => {
    expect(objArr([{ name: 'A' }, null, { name: 'B' }, undefined])).toEqual([
      { name: 'A' },
      { name: 'B' },
    ])
  })

  it('drops non-object elements rather than widening a scalar into a row', () => {
    expect(objArr([{ name: 'A' }, 'B', 7])).toEqual([{ name: 'A' }])
  })

  it('passes a clean array through untouched', () => {
    const clean = [{ city: 'Tyngsborough' }]
    expect(objArr(clean)).toEqual(clean)
  })

  it('handles null / undefined', () => {
    expect(objArr(null)).toEqual([])
    expect(objArr(undefined)).toEqual([])
  })
})

describe('arr', () => {
  it('preserves a stray string as a single element so content survives', () => {
    expect(arr('Varies' as unknown as string[])).toEqual(['Varies'])
  })

  it('returns [] for a blank string and for non-array non-strings', () => {
    expect(arr('  ' as unknown as string[])).toEqual([])
    expect(arr({ a: 1 } as unknown as string[])).toEqual([])
    expect(arr(null)).toEqual([])
  })
})

describe('str', () => {
  it('flattens an array to a comma list and drops non-strings', () => {
    expect(str(['a', 'b'])).toBe('a, b')
    expect(str(42)).toBe('')
    expect(str('plain')).toBe('plain')
  })
})
