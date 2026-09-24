import { describe, it, expect } from 'vitest'
import { resolvePreviewPageUrl } from './page-path'

const SITE = 'https://bblcpa.vercel.app/'

describe('resolvePreviewPageUrl', () => {
  it('defaults to the preview URL itself (base preserved)', () => {
    expect(resolvePreviewPageUrl(SITE, null)).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/', path: '/' })
    expect(resolvePreviewPageUrl(SITE, '')).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/', path: '/' })
  })

  it('an empty path keeps a path-ful preview URL unchanged (its own path + query)', () => {
    const withPath = 'https://x.vercel.app/home?draft=1'
    expect(resolvePreviewPageUrl(withPath, null)).toEqual({ ok: true, url: withPath, path: '/home' })
    expect(resolvePreviewPageUrl(withPath, '')).toEqual({ ok: true, url: withPath, path: '/home' })
  })

  it('a non-empty path still resolves same-origin against a path-ful preview URL', () => {
    expect(resolvePreviewPageUrl('https://x.vercel.app/home?draft=1', '/about')).toEqual({
      ok: true,
      url: 'https://x.vercel.app/about',
      path: '/about',
    })
  })

  it('resolves a normal page path on the same origin', () => {
    expect(resolvePreviewPageUrl(SITE, '/services/tax')).toEqual({
      ok: true,
      url: 'https://bblcpa.vercel.app/services/tax',
      path: '/services/tax',
    })
  })

  it('decodes before validating', () => {
    expect(resolvePreviewPageUrl(SITE, '%2Fabout')).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/about', path: '/about' })
  })

  it.each([
    ['no leading slash', 'about'],
    ['protocol-relative', '//evil.test/x'],
    ['encoded protocol-relative', '%2F%2Fevil.test'],
    ['absolute url', 'https://evil.test/'],
    ['backslash', '/\\evil.test'],
    ['traversal', '/a/../../etc/passwd'],
    ['encoded traversal', '/a/%2E%2E/%2E%2E/x'],
    ['dot segment', '/./x'],
    ['bad encoding', '/%E0%A4%A'],
    ['query string', '/x?y=1'],
    ['fragment', '/x#y'],
    ['too long', '/' + 'a'.repeat(300)],
  ])('rejects %s', (_label, raw) => {
    expect(resolvePreviewPageUrl(SITE, raw).ok).toBe(false)
  })

  it('rejects an unparseable site url', () => {
    expect(resolvePreviewPageUrl('not a url', '/').ok).toBe(false)
  })
})
