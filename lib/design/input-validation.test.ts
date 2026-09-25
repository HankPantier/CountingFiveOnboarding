import { describe, it, expect } from 'vitest'
import { displayHost, isPlainObject, isUuid, normalizeInputUrl, parseOptionalText, parseUrlInputKind } from './input-validation'

describe('normalizeInputUrl', () => {
  it.each([
    ['acme.com', 'https://acme.com/'],
    ['  https://acme.com/about  ', 'https://acme.com/about'],
    ['http://acme.com/a?b=1', 'http://acme.com/a?b=1'],
    ['acme.com:8080/x', 'https://acme.com:8080/x'],
  ])('accepts %s', (raw, url) => {
    expect(normalizeInputUrl(raw)).toEqual({ ok: true, url })
  })

  it.each([
    ['non-string', 42],
    ['empty', '   '],
    ['ftp', 'ftp://acme.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['mailto', 'mailto:a@acme.com'],
    ['credentials', 'https://user:pw@acme.com/'],
    ['no dot in host', 'https://localhost/'],
    ['spaces', 'https://not a url'],
    ['too long', 'https://acme.com/' + 'a'.repeat(300)],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeInputUrl(raw).ok).toBe(false)
  })
})

describe('parseOptionalText', () => {
  it('trims, and maps empty/absent to null', () => {
    expect(parseOptionalText('  hi ', 10, 'Label')).toEqual({ ok: true, value: 'hi' })
    expect(parseOptionalText('   ', 10, 'Label')).toEqual({ ok: true, value: null })
    expect(parseOptionalText(undefined, 10, 'Label')).toEqual({ ok: true, value: null })
    expect(parseOptionalText(null, 10, 'Label')).toEqual({ ok: true, value: null })
  })
  it('rejects too long and non-text', () => {
    expect(parseOptionalText('x'.repeat(11), 10, 'Label')).toEqual({ ok: false, reason: 'Label must be 10 characters or fewer.' })
    expect(parseOptionalText(5, 10, 'Notes')).toEqual({ ok: false, reason: 'Notes must be text.' })
  })
  it('strips control characters but keeps newlines and tabs', () => {
    expect(parseOptionalText('a\u0000b', 10, 'Label')).toEqual({ ok: true, value: 'ab' })
    expect(parseOptionalText('a\u0007b', 10, 'Label')).toEqual({ ok: true, value: 'ab' })
    expect(parseOptionalText('a\nb\tc', 10, 'Label')).toEqual({ ok: true, value: 'a\nb\tc' })
  })
  it('treats a string that becomes empty after stripping like an empty value', () => {
    expect(parseOptionalText('\u0000\u0007', 10, 'Label')).toEqual({ ok: true, value: null })
  })
})

describe('small guards', () => {
  it('isUuid', () => {
    expect(isUuid('0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e')).toBe(true)
    expect(isUuid('upload')).toBe(false)
  })
  it('isPlainObject', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
  })
  it('parseUrlInputKind', () => {
    expect(parseUrlInputKind('competitor_url')).toBe('competitor_url')
    expect(parseUrlInputKind('inspiration_image')).toBeNull()
    expect(parseUrlInputKind(3)).toBeNull()
  })
  it('displayHost', () => {
    expect(displayHost('https://www.acme.com/x')).toBe('acme.com')
    expect(displayHost(null)).toBeNull()
    expect(displayHost('nope')).toBeNull()
  })
})
