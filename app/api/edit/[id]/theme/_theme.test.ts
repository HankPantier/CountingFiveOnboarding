import { describe, it, expect } from 'vitest'
import { themeSourcesHtmlAttributes } from './_theme'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'

// ThemePreview (Controls tab) builds its <html> attributes with this helper.
describe('themeSourcesHtmlAttributes (Controls preview)', () => {
  it('carries the treatment flags and the draft style axes, nulling unset axes', () => {
    const attrs = themeSourcesHtmlAttributes({ headlineStyle: 'serif', eyebrowStyle: 'mono', style: { buttons: 'sharp' } })
    expect(attrs['data-headline']).toBe('serif')
    expect(attrs['data-eyebrow']).toBe('mono')
    expect(attrs['data-c5-buttons']).toBe('sharp')
    expect(attrs['data-c5-nav']).toBeNull()
  })

  it('every key passes the preview allowlist, so the composed shell shows the draft axes', () => {
    const html = composePreviewSrcDoc({
      shellHtml: '<html data-c5-nav="inverted"><head><!--__C5_THEME_SLOT__--></head><body></body></html>',
      themeCss: '',
      overridesCss: '',
      htmlAttributes: themeSourcesHtmlAttributes({ headlineStyle: 'sans', eyebrowStyle: 'standard', style: { cards: 'elevated' } }),
    })
    const tag = /<html\b[^>]*>/.exec(html)?.[0] ?? ''
    expect(tag).toContain('data-c5-cards="elevated"')
    expect(tag).not.toContain('data-c5-nav')
  })

  it('absent style removes every axis attribute', () => {
    const attrs = themeSourcesHtmlAttributes({ headlineStyle: 'sans', eyebrowStyle: 'standard' })
    expect(Object.entries(attrs).filter(([k]) => k.startsWith('data-c5-')).every(([, v]) => v === null)).toBe(true)
  })
})
