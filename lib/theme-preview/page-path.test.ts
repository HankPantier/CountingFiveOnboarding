import { describe, it, expect } from 'vitest'
import { resolvePreviewPageUrl } from './page-path'

const SITE = 'https://bblcpa.vercel.app/'

describe('resolvePreviewPageUrl', () => {
  it('defaults to the site root', () => {
    expect(resolvePreviewPageUrl(SITE, null)).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/', path: '/' })
    expect(resolvePreviewPageUrl(SITE, '')).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/', path: '/' })
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
