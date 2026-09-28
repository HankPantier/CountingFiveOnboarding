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
    expect(t.htmlAttributes).toMatchObject({ 'data-headline': 'serif', 'data-eyebrow': 'mono' })
  })
  it('falls back to defaults on unparseable design.json', () => {
    const t = composedThemeFromFiles({ designText: '{', themeCss: '', overridesCss: '' })
    expect(t.htmlAttributes).toMatchObject({ 'data-headline': 'sans', 'data-eyebrow': 'standard' })
    expect(t.htmlAttributes['data-c5-cards']).toBeNull()
    expect(t.typography.headingFont).toBe('Public Sans')
  })
  it('injects the theme into the shell and rewrites the treatment attributes', () => {
    const t = composedThemeFromFiles({ designText: '{"headlineStyle":"serif"}', themeCss: ':root{--c:1}', overridesCss: '' })
    const doc = composeThemeDoc('<html data-headline="sans"><head></head><body></body></html>', t)
    expect(doc).toContain('data-headline="serif"')
    expect(doc).toContain(':root{--c:1}')
  })
  it('sets every style-axis attribute: chosen values, null for the rest', () => {
    const t = composedThemeFromFiles({ designText: '{"style":{"cards":"flat"}}', themeCss: '', overridesCss: '' })
    expect(t.htmlAttributes['data-c5-cards']).toBe('flat')
    expect(t.htmlAttributes['data-c5-nav']).toBeNull()
    // 8 style axes + the logo size hook (template 2026.09.8) + 5 layout presets (2026.09.9).
    expect(Object.keys(t.htmlAttributes).filter((k) => k.startsWith('data-c5-'))).toHaveLength(14)
    expect(t.htmlAttributes['data-c5-logo-size']).toBeNull()
  })
  it('carries design.json logo.size so concept renders keep the site logo size', () => {
    const t = composedThemeFromFiles({ designText: '{"logo":{"size":"large"}}', themeCss: '', overridesCss: '' })
    expect(t.htmlAttributes['data-c5-logo-size']).toBe('large')
  })
  it('the composed doc removes live axis attributes the design does not set', () => {
    const t = composedThemeFromFiles({ designText: '{"style":{"cards":"flat"}}', themeCss: '', overridesCss: '' })
    const doc = composeThemeDoc('<html lang="en" data-c5-nav="bordered"><head></head><body></body></html>', t)
    expect(doc).not.toContain('data-c5-nav')
    expect(doc).toContain('data-c5-cards="flat"')
  })
  it('carries design.json layout presets and removes live presets the design does not set (2026.09.9)', () => {
    const t = composedThemeFromFiles({ designText: '{"layout":{"cards":"list","faq":"default","team":"bogus"}}', themeCss: '', overridesCss: '' })
    expect(t.htmlAttributes['data-c5-layout-cards']).toBe('list')
    expect(t.htmlAttributes['data-c5-layout-faq']).toBeNull()
    expect(t.htmlAttributes['data-c5-layout-team']).toBeNull()
    const doc = composeThemeDoc('<html lang="en" data-c5-layout-faq="split"><head></head><body></body></html>', t)
    expect(doc).not.toContain('data-c5-layout-faq')
    expect(doc).toContain('data-c5-layout-cards="list"')
  })
})
