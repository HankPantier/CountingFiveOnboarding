import { describe, expect, it } from 'vitest'
import {
  deepSetPath,
  deepMerge,
  getByPath,
  isPathFilled,
  preserveAppendOnlyMarkers,
  outOfRangeIndexPath,
} from './schema-write'

describe('preserveAppendOnlyMarkers — Phase 3 gate cannot silently re-open', () => {
  const before = { _meta: { phase3_completed_chunks: ['chunk1', 'chunk2a'] } }

  it('unions dropped prior markers back in when the model resends a partial array', () => {
    // Model sent only ["chunk2b"] — deepMerge would replace and drop chunk1/2a.
    const merged = deepMerge(before, { _meta: { phase3_completed_chunks: ['chunk2b'] } })
    preserveAppendOnlyMarkers(before, merged)
    expect((merged._meta as { phase3_completed_chunks: string[] }).phase3_completed_chunks).toEqual(
      ['chunk1', 'chunk2a', 'chunk2b']
    )
  })

  it('keeps prior markers when the update forgets to include the array at all', () => {
    const merged = deepMerge(before, { _meta: { opportunities_confirmed: true } })
    preserveAppendOnlyMarkers(before, merged)
    expect((merged._meta as { phase3_completed_chunks: string[] }).phase3_completed_chunks).toEqual(
      ['chunk1', 'chunk2a']
    )
  })

  it('dedupes and is a no-op when nothing new is added', () => {
    const merged = deepMerge(before, { _meta: { phase3_completed_chunks: ['chunk1', 'chunk2a'] } })
    preserveAppendOnlyMarkers(before, merged)
    expect((merged._meta as { phase3_completed_chunks: string[] }).phase3_completed_chunks).toEqual(
      ['chunk1', 'chunk2a']
    )
  })
})

describe('isPathFilled', () => {
  const obj = {
    business: { name: 'Acme', tagline: '', foundingYear: '2005' },
    brand: { hasBrandGuide: false, toneAdjectives: ['clear'] },
    niches: [{ name: 'Dental', painPoints: '' }, { name: 'Legal', painPoints: 'compliance' }],
  }
  it('is true for a non-empty string', () => expect(isPathFilled(obj, 'business.name')).toBe(true))
  it('is false for an empty string', () => expect(isPathFilled(obj, 'business.tagline')).toBe(false))
  it('is false for a missing path', () => expect(isPathFilled(obj, 'business.pricing')).toBe(false))
  it('is false for a default boolean (never a real answer)', () =>
    expect(isPathFilled(obj, 'brand.hasBrandGuide')).toBe(false))
  it('is true for a non-empty array', () => expect(isPathFilled(obj, 'brand.toneAdjectives')).toBe(true))
  it('handles bracket array paths', () => {
    expect(isPathFilled(obj, 'niches[0].painPoints')).toBe(false)
    expect(isPathFilled(obj, 'niches[1].painPoints')).toBe(true)
  })
  it('handles dot array paths', () => {
    expect(isPathFilled(obj, 'niches.1.painPoints')).toBe(true)
  })
})

describe('deepSetPath', () => {
  it('never leaves sparse slots, which JSONB would persist as null', () => {
    // A stale-index write (niches[7] against a 3-element array) used to extend
    // the array with holes that Postgres stored as null, and a null element then
    // threw "Cannot read properties of null (reading 'name')" in the generators.
    // See the Berg Advisors session.
    const out = deepSetPath({ niches: [{ name: 'A' }] }, 'niches[3].painPoints', ['x'])
    const niches = out.niches as unknown[]
    expect(niches).toHaveLength(4)
    expect(niches.some((n) => n == null)).toBe(false)
    expect(JSON.parse(JSON.stringify(niches))).toEqual([
      { name: 'A' }, {}, {}, { painPoints: ['x'] },
    ])
  })

  it('still allows appending one past the end', () => {
    const out = deepSetPath({ niches: [{ name: 'A' }] }, 'niches[1].name', 'B')
    expect(out.niches).toEqual([{ name: 'A' }, { name: 'B' }])
  })

  it('sets a top-level scalar without touching siblings', () => {
    const out = deepSetPath({ a: 1, b: 2 }, 'a', 9)
    expect(out).toEqual({ a: 9, b: 2 })
  })

  it('sets a nested object path, creating intermediates', () => {
    const out = deepSetPath({ business: { name: 'X' } }, 'business.tagline', 'Hi')
    expect(out).toEqual({ business: { name: 'X', tagline: 'Hi' } })
  })

  it('creates nested objects when missing', () => {
    const out = deepSetPath({}, 'a.b.c', 5)
    expect(out).toEqual({ a: { b: { c: 5 } } })
  })

  it('updates an array element by numeric index WITHOUT clobbering the array', () => {
    const schema = { team: [{ name: 'A', title: '' }, { name: 'B', title: '' }] }
    const out = deepSetPath(schema, 'team.1.title', 'Partner')
    expect(out.team).toEqual([
      { name: 'A', title: '' },
      { name: 'B', title: 'Partner' },
    ])
  })

  it('creates an array when the next segment is a numeric index', () => {
    const out = deepSetPath({}, 'list.0.x', 1)
    expect(Array.isArray((out as { list: unknown }).list)).toBe(true)
    expect(out).toEqual({ list: [{ x: 1 }] })
  })

  it('is immutable — does not mutate the input', () => {
    const schema = { team: [{ name: 'A' }] }
    const out = deepSetPath(schema, 'team.0.name', 'Z')
    expect(schema.team[0].name).toBe('A')
    expect((out.team as { name: string }[])[0].name).toBe('Z')
  })

  it('parses bracket notation into an array index, NOT a literal top-level key', () => {
    const out = deepSetPath({}, 'niches[3].description', 'x')
    expect(Object.keys(out).some(k => k.includes('['))).toBe(false)
    expect(out).toEqual({ niches: [{}, {}, {}, { description: 'x' }] })
  })

  it('updates an existing array element via bracket path without clobbering siblings', () => {
    const schema = { locations: [{ city: 'A', phone: '' }, { city: 'B', phone: '' }] }
    const out = deepSetPath(schema, 'locations[1].phone', '555')
    expect(out.locations).toEqual([
      { city: 'A', phone: '' },
      { city: 'B', phone: '555' },
    ])
  })

  it('handles mixed bracket + nested-array paths', () => {
    const out = deepSetPath({}, 'niches[0].subCategories[1].status', 'dropped')
    expect(out).toEqual({
      niches: [{ subCategories: [{}, { status: 'dropped' }] }],
    })
  })

  it('is immutable for bracket paths too', () => {
    const schema = { niches: [{ name: 'A' }] }
    const out = deepSetPath(schema, 'niches[0].name', 'Z')
    expect(schema.niches[0].name).toBe('A')
    expect((out.niches as { name: string }[])[0].name).toBe('Z')
  })

  it('folds a dotted-KEY update map into nested structure (no orphan key)', () => {
    // Mirrors app/api/chat pre-splitting: applying each dotted key via deepSetPath
    // must nest, never create a literal "business.name" property.
    let nested: Record<string, unknown> = {}
    for (const [k, v] of Object.entries({ 'business.name': 'X', 'business.tagline': 'Y' })) {
      nested = deepSetPath(nested, k, v)
    }
    expect(nested).toEqual({ business: { name: 'X', tagline: 'Y' } })
    expect(Object.keys(nested)).toEqual(['business'])
  })
})

describe('deepMerge', () => {
  it('deep-merges nested objects, replacing arrays and scalars', () => {
    const out = deepMerge(
      { business: { name: 'X', tags: ['a'] }, keep: true },
      { business: { tagline: 'Y', tags: ['b'] } }
    )
    expect(out).toEqual({ business: { name: 'X', tagline: 'Y', tags: ['b'] }, keep: true })
  })
})

describe('getByPath', () => {
  const schema = { business: { tagline: 'Hi' }, team: [{ title: 'Partner' }] }
  it('reads object paths', () => {
    expect(getByPath(schema, 'business.tagline')).toBe('Hi')
  })
  it('reads array-index paths', () => {
    expect(getByPath(schema, 'team.0.title')).toBe('Partner')
  })
  it('returns undefined for missing paths', () => {
    expect(getByPath(schema, 'business.nope')).toBeUndefined()
    expect(getByPath(schema, 'team.5.title')).toBeUndefined()
  })
  it('reads bracket-index paths (matches how suggestions are authored)', () => {
    const s = { niches: [{}, {}, {}, { description: 'x' }] }
    expect(getByPath(s, 'niches[3].description')).toBe('x')
    expect(getByPath(s, 'niches[9].description')).toBeUndefined()
  })
  it('resolves the array base for an append lookup via a bracket path', () => {
    const s = { team: [{ name: 'A' }] }
    expect(getByPath(s, 'team')).toEqual([{ name: 'A' }])
  })
})

describe('outOfRangeIndexPath', () => {
  const schema = { niches: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }

  it('flags a stale index beyond the stored array', () => {
    expect(outOfRangeIndexPath(schema, 'niches[7].painPoints')).toBe('niches[7]')
  })

  it('allows an in-range update and a one-past-the-end append', () => {
    expect(outOfRangeIndexPath(schema, 'niches[1].name')).toBeNull()
    expect(outOfRangeIndexPath(schema, 'niches[3].name')).toBeNull()
  })

  it('ignores paths that never reach an array', () => {
    expect(outOfRangeIndexPath(schema, 'business.tagline')).toBeNull()
  })

  it('does not flag an array that is not there yet', () => {
    expect(outOfRangeIndexPath({}, 'niches[3].name')).toBeNull()
  })
})
