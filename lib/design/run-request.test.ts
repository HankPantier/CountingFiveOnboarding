import { describe, it, expect } from 'vitest'
import { IID } from './__fixtures__/rows'
import { normalizeRunPagePath, parseCreateRunBody } from './run-request'

describe('normalizeRunPagePath', () => {
  it('defaults to the home page', () => {
    expect(normalizeRunPagePath(undefined)).toEqual({ ok: true, path: '/' })
    expect(normalizeRunPagePath('')).toEqual({ ok: true, path: '/' })
  })
  it('decodes before validating (CLAUDE.md rule 8)', () => {
    expect(normalizeRunPagePath('/services%2Ftax')).toEqual({ ok: true, path: '/services/tax' })
    expect(normalizeRunPagePath('%2F%2Fevil.test').ok).toBe(false)
    expect(normalizeRunPagePath('/a/%2E%2E/b').ok).toBe(false)
  })
  it('rejects a decoded path that still contains a % (so a downstream single decode stays idempotent)', () => {
    // '/100%2525' decodes once to '/100%25' — which still contains a literal
    // '%', so a second decode elsewhere would not be idempotent. Reject it.
    expect(normalizeRunPagePath('/100%2525')).toEqual({ ok: false, reason: 'pagePath must be a plain path.' })
  })
  it.each(['services', '//evil.test', '/a?b=1', '/a#x', '/a\\b', `/${'a'.repeat(201)}`, 7, '%E0%A4%A'])('rejects %j', (p) => {
    expect(normalizeRunPagePath(p).ok).toBe(false)
  })
})

describe('parseCreateRunBody', () => {
  it('applies the defaults', () => {
    expect(parseCreateRunBody({})).toEqual({
      ok: true,
      value: { paletteFreedom: 'evolve', adminBrief: null, inputIds: [], conceptCount: 3, pagePath: '/' },
    })
  })
  it('accepts a full body and de-duplicates input ids', () => {
    const r = parseCreateRunBody({ paletteFreedom: 'free', adminBrief: '  Bolder  ', inputIds: [IID, IID], conceptCount: 2, pagePath: '/about' })
    expect(r).toEqual({ ok: true, value: { paletteFreedom: 'free', adminBrief: 'Bolder', inputIds: [IID], conceptCount: 2, pagePath: '/about' } })
  })
  it.each([
    [[], 'Invalid JSON body.'],
    [{ paletteFreedom: 'wild' }, 'paletteFreedom must be keep, evolve or free.'],
    [{ conceptCount: 1 }, 'conceptCount must be 2 or 3.'],
    [{ conceptCount: 2.5 }, 'conceptCount must be 2 or 3.'],
    [{ inputIds: 'x' }, 'inputIds must be a list of input ids.'],
    [{ inputIds: ['nope'] }, 'inputIds must be a list of input ids.'],
    [{ adminBrief: 'x'.repeat(4001) }, 'The brief must be 4000 characters or fewer.'],
  ])('rejects %j', (body, reason) => {
    expect(parseCreateRunBody(body)).toEqual({ ok: false, reason })
  })
  it('caps the selected inputs at 5', () => {
    const ids = Array.from({ length: 6 }, (_, i) => `0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7${i}`)
    expect(parseCreateRunBody({ inputIds: ids })).toEqual({ ok: false, reason: 'Pick at most 5 inputs.' })
  })
})
