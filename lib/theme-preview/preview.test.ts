import { describe, it, expect } from 'vitest'
import { transformShellHtml } from './build-preview-shell'
import { composePreviewSrcDoc, THEME_SLOT } from './compose-srcdoc'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'

// A minimal page shaped like the real Next output: a stylesheet whose utilities
// reference var(--color-primary), the site's baked theme :root, a script, and a
// CSP meta.
const PAGE = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<link rel="stylesheet" href="/_next/static/css/app.css">
<style>:root{--color-primary:#000000}.bg-primary{background:var(--color-primary)}</style>
<script src="/_next/static/chunks/main.js"></script>
</head><body>
<section data-block="hero"><h1 class="bg-primary">Hi</h1></section>
<script>console.log('hydrate')</script>
</body></html>`

describe('transformShellHtml', () => {
  const shell = transformShellHtml(PAGE, 'https://example.com/')
  if (!shell.ok) throw new Error(shell.reason)

  it('sets a base href to the deployed origin', () => {
    expect(shell.shellHtml).toContain('<base href="https://example.com/">')
  })

  it('strips scripts and the CSP meta', () => {
    expect(shell.shellHtml).not.toContain('<script')
    expect(shell.shellHtml.toLowerCase()).not.toContain('content-security-policy')
  })

  it('keeps the real body markup and the site stylesheet link', () => {
    expect(shell.shellHtml).toContain('data-block="hero"')
    expect(shell.shellHtml).toContain('/_next/static/css/app.css')
  })

  it('places the theme slot as the last thing in <head>', () => {
    expect(shell.shellHtml).toContain(`${THEME_SLOT}</head>`)
  })

  it('rejects a page with no <head>', () => {
    const r = transformShellHtml('<html><body>x</body></html>', 'https://example.com/')
    expect(r.ok).toBe(false)
  })
})

describe('composePreviewSrcDoc', () => {
  const shell = transformShellHtml(PAGE, 'https://example.com/')
  if (!shell.ok) throw new Error(shell.reason)

  const themeCss = ':root{--color-primary:#ff0000}'
  const doc = composePreviewSrcDoc({ shellHtml: shell.shellHtml, themeCss, overridesCss: '[data-block="hero"] h1{font-size:5rem}' })

  it('injects the edited theme AFTER the site theme (later in <head> wins)', () => {
    const sitePrimary = doc.indexOf('--color-primary:#000000')
    const injectedPrimary = doc.indexOf('--color-primary:#ff0000')
    expect(sitePrimary).toBeGreaterThan(-1)
    expect(injectedPrimary).toBeGreaterThan(sitePrimary) // override comes later → wins
    expect(injectedPrimary).toBeLessThan(doc.indexOf('</head>'))
  })

  it('aliases the font-loaded vars so type resolves', () => {
    expect(doc).toContain('--font-heading-loaded:"Public Sans"')
  })

  it('includes the per-block override', () => {
    expect(doc).toContain('[data-block="hero"] h1{font-size:5rem}')
  })

  it('neutralizes a </style> breakout in injected CSS', () => {
    const evil = composePreviewSrcDoc({ shellHtml: shell.shellHtml, themeCss: '</style><script>x</script>', overridesCss: '' })
    expect(evil).not.toContain('</style><script>')
  })

  it('loads the chosen fonts when typography is supplied', () => {
    const doc2 = composePreviewSrcDoc({
      shellHtml: shell.shellHtml,
      themeCss: '',
      overridesCss: '',
      typography: {
        headingFont: 'Lora',
        bodyFont: 'Inter',
        accentFont: 'Fraunces',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Lora&family=Inter&display=swap',
      },
    })
    expect(doc2).toContain('--font-heading-loaded:"Lora"')
    expect(doc2).toContain('--font-body-loaded:"Inter"')
    expect(doc2).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora')
  })

  // Regression: legacy design.json omits accentFont (added later for Ink & Clay).
  // A partial typography must fall back per-field, never throw at mount.
  it('does not throw and falls back per-field when a font slot is missing', () => {
    const partial = { headingFont: 'Lora', bodyFont: 'Inter' } as unknown as Parameters<typeof composePreviewSrcDoc>[0]['typography']
    let doc3 = ''
    expect(() => {
      doc3 = composePreviewSrcDoc({ shellHtml: shell.shellHtml, themeCss: '', overridesCss: '', typography: partial })
    }).not.toThrow()
    expect(doc3).toContain('--font-heading-loaded:"Lora"')
    expect(doc3).toContain('--font-accent-loaded:"Fraunces"') // filled default
  })
})

describe('normalizeTypography', () => {
  it('fills missing font slots with template defaults and builds a fonts URL', () => {
    const t = normalizeTypography({ headingFont: 'Lora' })
    expect(t.headingFont).toBe('Lora')
    expect(t.bodyFont).toBe('Public Sans')
    expect(t.accentFont).toBe('Fraunces')
    expect(t.googleFontsUrl).toContain('Lora')
  })

  it('returns a complete object for undefined input', () => {
    const t = normalizeTypography(undefined)
    expect(t).toMatchObject({ headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' })
    expect(typeof t.googleFontsUrl).toBe('string')
  })

  it('preserves an existing googleFontsUrl', () => {
    const t = normalizeTypography({ headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces', googleFontsUrl: 'https://example.com/fonts' })
    expect(t.googleFontsUrl).toBe('https://example.com/fonts')
  })
})
