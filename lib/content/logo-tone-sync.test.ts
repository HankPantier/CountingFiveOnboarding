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
  it('clears an explicit "dark" tone too (absent = dark)', () => {
    const out = retoneBrandJson(brand({ primary: 'l.png', alt: 'a', tone: 'dark' }), false)
    expect(JSON.parse(out!).logo.tone).toBeUndefined()
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
  it('returns null for invalid JSON or no logo object', () => {
    expect(retoneBrandJson('nope', true)).toBeNull()
    expect(retoneBrandJson(JSON.stringify({ firm: {} }), true)).toBeNull()
  })
})
