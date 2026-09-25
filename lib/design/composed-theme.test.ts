import { describe, it, expect } from 'vitest'
import { composeThemeDoc, composedThemeFromFiles } from './composed-theme'

describe('composedThemeFromFiles', () => {
  it('derives fonts + treatment attributes from design.json', () => {
    const t = composedThemeFromFiles({
      designText: JSON.stringify({ typography: { headingFont: 'Fraunces', bodyFont: 'Public Sans' }, headlineStyle: 'serif', eyebrowStyle: 'mono' }),
      themeCss: ':root{--x:1}',
      overridesCss: '[data-block="hero"]{}',
    })
    expect(t.typography.headingFont).toBe('Fraunces')
    expect(t.typography.accentFont).toBe('Fraunces') // normalizeTypography default
    expect(t.typography.googleFontsUrl).toContain('fonts.googleapis.com')
    expect(t.htmlAttributes).toEqual({ 'data-headline': 'serif', 'data-eyebrow': 'mono' })
  })
  it('falls back to defaults on unparseable design.json', () => {
    const t = composedThemeFromFiles({ designText: '{', themeCss: '', overridesCss: '' })
    expect(t.htmlAttributes).toEqual({ 'data-headline': 'sans', 'data-eyebrow': 'standard' })
    expect(t.typography.headingFont).toBe('Public Sans')
  })
  it('injects the theme into the shell and rewrites the treatment attributes', () => {
    const t = composedThemeFromFiles({ designText: '{"headlineStyle":"serif"}', themeCss: ':root{--c:1}', overridesCss: '' })
    const doc = composeThemeDoc('<html data-headline="sans"><head></head><body></body></html>', t)
    expect(doc).toContain('data-headline="serif"')
    expect(doc).toContain(':root{--c:1}')
  })
})
