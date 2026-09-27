import { describe, expect, it } from 'vitest'
import { brandLogoAssetPath, isBrandLogoPath, retoneBrandJson } from './logo-tone-sync'

const brand = (logo: Record<string, unknown>) =>
  JSON.stringify({ firm: { name: 'Acme' }, palette: { primary: '#123456' }, logo }, null, 2) + '\n'

describe('brandLogoAssetPath', () => {
  it('maps a bare filename to public/content-assets/', () => {
    expect(brandLogoAssetPath('logo.png')).toBe('public/content-assets/logo.png')
  })
  it('accepts /content-assets/ and public/ prefixes', () => {
    expect(brandLogoAssetPath('/content-assets/logo.svg')).toBe('public/content-assets/logo.svg')
    expect(brandLogoAssetPath('public/content-assets/logo.svg')).toBe('public/content-assets/logo.svg')
  })
  it('rejects empty, URLs and traversal', () => {
    expect(brandLogoAssetPath('')).toBeNull()
    expect(brandLogoAssetPath(undefined)).toBeNull()
    expect(brandLogoAssetPath('https://cdn.example.com/logo.png')).toBeNull()
    expect(brandLogoAssetPath('//cdn.example.com/logo.png')).toBeNull()
    expect(brandLogoAssetPath('../secrets.png')).toBeNull()
  })
})

describe('isBrandLogoPath', () => {
  it('matches only the referenced logo', () => {
    const text = brand({ primary: 'firm-logo.png', alt: 'Acme logo' })
    expect(isBrandLogoPath(text, 'public/content-assets/firm-logo.png')).toBe(true)
    expect(isBrandLogoPath(text, 'public/content-assets/hero.jpg')).toBe(false)
  })
  it('is false for unparseable brand.json', () => {
    expect(isBrandLogoPath('{not json', 'public/content-assets/logo.png')).toBe(false)
  })
})

describe('retoneBrandJson', () => {
  it('sets tone "light" for a light replacement', () => {
    const out = retoneBrandJson(brand({ primary: 'l.png', alt: 'a' }), true)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!).logo).toEqual({ primary: 'l.png', alt: 'a', tone: 'light' })
    expect(out!.endsWith('}\n')).toBe(true)
  })
  it('clears a stale "light" tone for a dark replacement', () => {
    const out = retoneBrandJson(brand({ primary: 'l.png', alt: 'a', tone: 'light' }), false)
    expect(JSON.parse(out!).logo).toEqual({ primary: 'l.png', alt: 'a' })
  })
  it('keeps an explicit "dark" tone for a dark logo, but a conclusively light one overrides it', () => {
    expect(retoneBrandJson(brand({ primary: 'l.png', alt: 'a', tone: 'dark' }), false)).toBeNull()
    const out = retoneBrandJson(brand({ primary: 'l.png', alt: 'a', tone: 'dark' }), true)
    expect(JSON.parse(out!).logo.tone).toBe('light')
  })
  it('returns null when nothing changes', () => {
    expect(retoneBrandJson(brand({ primary: 'l.png', alt: 'a', tone: 'light' }), true)).toBeNull()
    expect(retoneBrandJson(brand({ primary: 'l.png', alt: 'a' }), false)).toBeNull()
  })
  it('keeps every other field', () => {
    const out = retoneBrandJson(brand({ primary: 'l.png', alt: 'a' }), true)!
    expect(JSON.parse(out).palette).toEqual({ primary: '#123456' })
    expect(JSON.parse(out).firm).toEqual({ name: 'Acme' })
  })
  it('edits only the tone line — key order, indentation, spacing and newline are kept', () => {
    // Deliberately NOT JSON.stringify's layout: 4-space indent, a compact
    // palette line, logo before contact, no trailing newline.
    const text = [
      '{',
      '    "firm": { "name": "Acme" },',
      '    "logo": {',
      '        "primary": "logo.png",',
      '        "alt": "Acme logo"',
      '    },',
      '    "palette": {"primary": "#123456"}',
      '}',
    ].join('\n')
    const lit = retoneBrandJson(text, true)!
    expect(lit).toBe(text.replace('"alt": "Acme logo"', '"alt": "Acme logo",\n        "tone": "light"'))
    // …and back: removing it restores the original bytes exactly.
    expect(retoneBrandJson(lit, false)).toBe(text)
  })
  it('rewrites an existing tone value in place, and removes a first or only member cleanly', () => {
    const dark = '{"logo": {"tone": "dark", "primary": "l.png"}}\n'
    expect(retoneBrandJson(dark, true)).toBe('{"logo": {"tone": "light", "primary": "l.png"}}\n')
    expect(retoneBrandJson('{"logo": {"tone": "light", "primary": "l.png"}}', false)).toBe('{"logo": {"primary": "l.png"}}')
    expect(retoneBrandJson('{"logo": {"tone": "light"}}', false)).toBe('{"logo": {}}')
    expect(retoneBrandJson('{"logo": {"primary": "l.png"}}', true)).toBe('{"logo": {"primary": "l.png", "tone": "light"}}')
  })
  it('keeps CRLF line endings and never touches a "tone" key elsewhere', () => {
    const text = '{\r\n  "tone": "formal",\r\n  "logo": {\r\n    "primary": "l.png",\r\n    "tone": "light"\r\n  }\r\n}\r\n'
    expect(retoneBrandJson(text, false)).toBe('{\r\n  "tone": "formal",\r\n  "logo": {\r\n    "primary": "l.png"\r\n  }\r\n}\r\n')
  })
  it('returns null for invalid JSON or no logo object', () => {
    expect(retoneBrandJson('nope', true)).toBeNull()
    expect(retoneBrandJson(JSON.stringify({ firm: {} }), true)).toBeNull()
  })
})
