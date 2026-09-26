import { describe, it, expect } from 'vitest'
import * as themeEdit from './theme-edit'
import { patchBrandPalette, patchDesignTypography, patchDesignFlags, patchDesignStyle } from './theme-edit'

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

describe('patchDesignTypography', () => {
  it('changes a font slot and rebuilds the Google Fonts URL from all families', () => {
    const r = patchDesignTypography(DESIGN, { headingFont: 'Inter' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.design.typography.headingFont).toBe('Inter')
    expect(r.design.typography.bodyFont).toBe('Public Sans') // untouched
    expect(r.design.typography.googleFontsUrl).toContain('family=Inter')
    expect(r.design.typography.googleFontsUrl).toContain('family=Public+Sans')
    expect(r.design.typography.googleFontsUrl).toContain('family=Fraunces')
    expect(r.changed).toBe(true)
  })
  it('rejects a font outside the curated list', () => {
    const r = patchDesignTypography(DESIGN, { headingFont: 'Comic Sans MS' })
    expect(r.ok).toBe(false)
  })
  it('rejects an empty patch', () => {
    const r = patchDesignTypography(DESIGN, {})
    expect(r.ok).toBe(false)
  })
})

describe('patchDesignFlags', () => {
  it('sets a non-default treatment flag', () => {
    const r = patchDesignFlags(DESIGN, { headlineStyle: 'serif', eyebrowStyle: 'mono', darkSections: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.design.headlineStyle).toBe('serif')
    expect(r.design.eyebrowStyle).toBe('mono')
    expect(r.design.darkSections).toBe(true)
    expect(r.changed).toBe(true)
  })
  it('deletes a flag when set back to its default (keeps design.json minimal)', () => {
    const withFlags = patchDesignFlags(DESIGN, { headlineStyle: 'serif', darkSections: true })
    expect(withFlags.ok).toBe(true)
    if (!withFlags.ok) return
    const reset = patchDesignFlags(withFlags.next, { headlineStyle: 'sans', darkSections: false })
    expect(reset.ok).toBe(true)
    if (!reset.ok) return
    expect('headlineStyle' in reset.design).toBe(false)
    expect('darkSections' in reset.design).toBe(false)
    // Back to the original untouched design.
    expect(reset.next).toBe(DESIGN)
  })
  it('rejects an invalid flag value', () => {
    // @ts-expect-error — exercising runtime validation with a bad value
    const r = patchDesignFlags(DESIGN, { headlineStyle: 'cursive' })
    expect(r.ok).toBe(false)
  })
  it('rejects an empty patch', () => {
    const r = patchDesignFlags(DESIGN, {})
    expect(r.ok).toBe(false)
  })
})

describe('dead theme-chat helpers', () => {
  it('are gone (the design-overrides region is owned by the Design Studio)', () => {
    expect('patchDesignTokens' in themeEdit).toBe(false)
    expect('upsertBlockOverride' in themeEdit).toBe(false)
  })
})

describe('patchDesignStyle', () => {
  const base = JSON.stringify({ typography: {}, roundness: 'pill' }, null, 2) + '\n'
  it('writes non-default axes and deletes defaults (omit-at-default)', () => {
    const r = patchDesignStyle(base, { cards: 'flat', nav: 'default' })
    expect(r.ok && r.design.style).toEqual({ cards: 'flat' })
    const back = r.ok ? patchDesignStyle(r.next, { cards: 'default' }) : null
    expect(back?.ok && back.design.style).toBeUndefined()
    expect(back?.ok && back.next).toBe(base)
  })
  it('an all-default patch on a design without style is a no-op', () => {
    const r = patchDesignStyle(base, { cards: 'default' })
    expect(r.ok && r.changed).toBe(false)
  })
  it('rejects unknown axes / values and empty patches', () => {
    expect(patchDesignStyle(base, { cards: 'wobbly' } as never).ok).toBe(false)
    expect(patchDesignStyle(base, { glitter: 'x' } as never).ok).toBe(false)
    expect(patchDesignStyle(base, {}).ok).toBe(false)
  })
})
