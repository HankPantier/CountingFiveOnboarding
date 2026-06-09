import { describe, expect, it } from 'vitest'
import { deepSetPath, deepMerge, getByPath } from './schema-write'

describe('deepSetPath', () => {
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
})
