import { describe, it, expect } from 'vitest'
import { paletteSummary, typographySummary, toPaletteData } from './sync-mbp-theme'

const palette = {
  primary: '#003b71',
  secondary: '#e8eef5',
  complementary: '#c46a2b',
  action: '#00c1de',
  nearBlack: '#101820',
  nearWhite: '#fafaf7',
}

describe('MBP theme summaries', () => {
  it('summarises the palette in role order', () => {
    expect(paletteSummary(palette)).toBe(
      'primary: #003b71, secondary: #e8eef5, complementary: #c46a2b, action: #00c1de, nearBlack: #101820, nearWhite: #fafaf7'
    )
  })

  it('summarises typography', () => {
    expect(typographySummary({ headingFont: 'Fraunces', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: 'x' })).toBe(
      'Headings: Fraunces · Body: Public Sans · Accent: Fraunces'
    )
  })

  it('keeps existing swatch names and falls back to the role', () => {
    const out = toPaletteData(palette, { primary: { hex: '#000000', name: 'Harbor Navy' } } as never)
    expect(out.primary).toEqual({ hex: '#003b71', name: 'Harbor Navy' })
    expect(out.action).toEqual({ hex: '#00c1de', name: 'action' })
  })
})
