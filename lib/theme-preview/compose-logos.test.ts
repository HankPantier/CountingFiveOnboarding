import { describe, expect, it } from 'vitest'
import { composePreviewSrcDoc, swapPreviewLogos } from './compose-srcdoc'

const P = 'data:image/png;base64,AAAA'
const F = 'data:image/svg+xml;base64,BBBB'

const shell = (footerImg = '<img alt="A" src="/_next/image?url=old.png" srcset="/_next/image?url=old.png 1x" class="h-8 w-auto invert opacity-90">') =>
  `<html><head></head><body>
<header data-component="navbar"><a href="/" class="flex" data-c5="logo"><img alt="A" src="/_next/image?url=old.png" srcset="/x 1x, /y 2x" width="160" class="h-8 w-auto"></a></header>
<main>…</main>
<footer data-component="footer"><a href="/" class="inline-flex" aria-label="A home" data-c5="logo">${footerImg}</a></footer>
</body></html>`

describe('swapPreviewLogos', () => {
  it('swaps the header and (fallback) footer logo to the draft primary, keeping the footer invert', () => {
    const out = swapPreviewLogos(shell(), { primary: P, footer: null })
    expect(out).not.toContain('srcset')
    expect(out).not.toContain('old.png')
    const [header, footer] = out.split('data-component="footer"')
    expect(header).toContain(`src="${P}"`)
    expect(footer).toContain(`src="${P}"`)
    expect(footer).toMatch(/class="h-8 w-auto invert opacity-90"/)
  })

  it('uses the footer variant in the footer without the invert classes', () => {
    const out = swapPreviewLogos(shell(), { primary: P, footer: F })
    const [header, footer] = out.split('data-component="footer"')
    expect(header).toContain(`src="${P}"`)
    expect(footer).toContain(`src="${F}"`)
    expect(footer).toMatch(/class="h-8 w-auto"/)
  })

  it('inserts an <img> when the live site shows the firm name as text', () => {
    const out = swapPreviewLogos(shell('<span class="font-semibold">Acme</span>'), { primary: P, footer: null })
    const footer = out.split('data-component="footer"')[1]
    expect(footer).toContain(`<img alt="" class="h-8 w-auto invert opacity-90" src="${P}">`)
    expect(footer).not.toContain('Acme</span>')
  })

  it('ignores anything that is not an inline image data URL', () => {
    const html = shell()
    expect(swapPreviewLogos(html, { primary: 'https://evil.example/x.png', footer: null })).toBe(html)
    expect(swapPreviewLogos(html, { primary: 'javascript:alert(1)', footer: '"><script>' })).toBe(html)
    expect(swapPreviewLogos(html, { primary: null, footer: null })).toBe(html)
  })

  it('is applied by composePreviewSrcDoc, and the logo tone attribute is allowlisted', () => {
    const out = composePreviewSrcDoc({
      shellHtml: shell(),
      themeCss: '',
      overridesCss: '',
      htmlAttributes: { 'data-c5-logo-tone': 'light' },
      logos: { primary: P, footer: null },
    })
    expect(out).toContain('<html data-c5-logo-tone="light">')
    expect(out).toContain(`src="${P}"`)
  })
})
