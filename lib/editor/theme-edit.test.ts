import { describe, it, expect } from 'vitest'
import { patchBrandPalette, patchDesignTokens, upsertBlockOverride } from './theme-edit'

const BRAND = JSON.stringify(
  {
    firm: { name: 'X' },
    contact: {},
    palette: {
      primary: '#003b71',
      secondary: '#6c7278',
      complementary: '#b8422e',
      action: '#00c1de',
      nearBlack: '#1a1c1e',
      nearWhite: '#f7f5f2',
    },
    social: [],
    certifications: [],
    logo: { primary: '', alt: '' },
  },
  null,
  2
) + '\n'

const DESIGN = JSON.stringify(
  {
    typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', googleFontsUrl: '', accentFont: 'Fraunces' },
    roundness: 'pill',
    density: 'balanced',
    visualFeel: 'modern',
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '48px', '2xl': '96px' },
    radius: { none: '0px', sm: '4px', md: '8px', lg: '16px', pill: '9999px' },
  },
  null,
  2
) + '\n'

describe('patchBrandPalette', () => {
  it('merges a single role and lowercases the hex', () => {
    const r = patchBrandPalette(BRAND, { primary: '#7A1F1F' })
    if (!r.ok) throw new Error(r.reason)
    expect(r.brand.palette.primary).toBe('#7a1f1f')
    expect(r.brand.palette.secondary).toBe('#6c7278') // untouched
    expect(r.changed).toBe(true)
    expect(r.next.endsWith('\n')).toBe(true)
  })

  it('rejects a non-hex value', () => {
    const r = patchBrandPalette(BRAND, { primary: 'navy' })
    expect(r.ok).toBe(false)
  })

  it('rejects a CSS-injection attempt in a color', () => {
    const r = patchBrandPalette(BRAND, { action: '#fff; } body { display:none' })
    expect(r.ok).toBe(false)
  })

  it('reports no change when the color already matches', () => {
    const r = patchBrandPalette(BRAND, { primary: '#003b71' })
    if (!r.ok) throw new Error(r.reason)
    expect(r.changed).toBe(false)
  })
})

describe('patchDesignTokens', () => {
  it('sets a radius value', () => {
    const r = patchDesignTokens(DESIGN, { radius: { lg: '4px' } })
    if (!r.ok) throw new Error(r.reason)
    expect(r.design.radius.lg).toBe('4px')
    expect(r.design.radius.pill).toBe('9999px') // untouched
  })

  it('rejects a non-length radius value', () => {
    const r = patchDesignTokens(DESIGN, { radius: { lg: 'round' } })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown enum', () => {
    // @ts-expect-error — exercising the runtime guard with a bad value
    const r = patchDesignTokens(DESIGN, { roundness: 'blobby' })
    expect(r.ok).toBe(false)
  })
})

describe('upsertBlockOverride', () => {
  it('appends a scoped rule for a known block', () => {
    const r = upsertBlockOverride('', 'hero', '[data-block="hero"] h1 { font-size: 3.5rem; }')
    if (!r.ok) throw new Error(r.reason)
    expect(r.next).toContain('/* theme-editor:hero */')
    expect(r.next).toContain('font-size: 3.5rem')
  })

  it('replaces the prior rule for the same block instead of stacking', () => {
    const first = upsertBlockOverride('', 'hero', 'a{}')
    if (!first.ok) throw new Error(first.reason)
    const second = upsertBlockOverride(first.next, 'hero', 'b{}')
    if (!second.ok) throw new Error(second.reason)
    // Count the exact start marker "/* theme-editor:hero */" — the end marker
    // "/* /theme-editor:hero */" has a leading slash, so it won't match.
    expect(second.next.match(/\/\* theme-editor:hero \*\//g)?.length).toBe(1)
    expect(second.next).toContain('b{}')
    expect(second.next).not.toContain('a{}')
  })

  it('rejects an unknown block', () => {
    const r = upsertBlockOverride('', 'not-a-block', 'a{}')
    expect(r.ok).toBe(false)
  })

  it('rejects @import and remote url()', () => {
    expect(upsertBlockOverride('', 'hero', '@import url(http://evil.test/x.css);').ok).toBe(false)
    expect(upsertBlockOverride('', 'hero', 'a{background:url(https://evil.test/x.png)}').ok).toBe(false)
  })
})
