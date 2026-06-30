import { describe, expect, it } from 'vitest'
import chroma from 'chroma-js'
import { derivePalette, ensureContrast, NEUTRAL_PALETTE } from './derive-palette'

describe('derivePalette', () => {
  it('sets primary/secondary and derives a distinct complementary', () => {
    const p = derivePalette('#ff0000', '#0000ff')
    expect(p.primary.hex.toLowerCase()).toBe('#ff0000')
    expect(p.secondary.hex.toLowerCase()).toBe('#0000ff')
    expect(p.complementary.hex.toLowerCase()).not.toBe('#ff0000')
  })

  it('produces WCAG-AA near-black / near-white neutrals', () => {
    const p = derivePalette('#098195', '#231f20')
    expect(chroma.contrast(p.nearBlack.hex, p.nearWhite.hex)).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to neutral hexes for invalid input', () => {
    const p = derivePalette('not-a-color', '')
    expect(p.primary.hex).toBe(NEUTRAL_PALETTE.primary.hex)
    expect(p.secondary.hex).toBe(NEUTRAL_PALETTE.secondary.hex)
  })
})

describe('ensureContrast', () => {
  it('raises a low-contrast pair to >= 4.5', () => {
    const { dark, light } = ensureContrast('#777777', '#888888')
    expect(chroma.contrast(dark, light)).toBeGreaterThanOrEqual(4.5)
  })
})
