import { describe, expect, it } from 'vitest'
import chroma from 'chroma-js'
import {
  derivePalette,
  ensureContrast,
  NEUTRAL_PALETTE,
  pickRasterBrandColors,
  rankPixelColors,
} from './derive-palette'

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

// Build a raw RGBA buffer from [hex, pixelCount, alpha?] runs.
function pixels(runs: Array<[string, number, number?]>): Uint8Array {
  const out: number[] = []
  for (const [hex, n, a = 255] of runs) {
    const [r, g, b] = chroma(hex).rgb()
    for (let i = 0; i < n; i++) out.push(r, g, b, a)
  }
  return Uint8Array.from(out)
}

describe('rankPixelColors', () => {
  it('ranks by frequency and returns averaged real colors', () => {
    const ranked = rankPixelColors(pixels([['#0055aa', 10], ['#ff0000', 30]]), 4)
    expect(ranked[0]).toBe('#ff0000')
    expect(ranked[1]).toBe('#0055aa')
  })

  it('merges near-identical (anti-aliased) shades into one bucket', () => {
    const ranked = rankPixelColors(pixels([['#ff0000', 10], ['#fe0101', 10]]), 4)
    expect(ranked).toHaveLength(1)
  })

  it('skips transparent pixels and handles RGB input', () => {
    expect(rankPixelColors(pixels([['#ff0000', 5, 0]]), 4)).toEqual([])
    expect(rankPixelColors(Uint8Array.from([0, 0, 255, 0, 0, 255]), 3)).toEqual(['#0000ff'])
    expect(rankPixelColors(Uint8Array.from([1, 2]), 2)).toEqual([])
  })
})

describe('pickRasterBrandColors', () => {
  it('ignores a dominant white/grey background and picks the brand colors', () => {
    const picked = pickRasterBrandColors(
      pixels([['#ffffff', 500], ['#888888', 200], ['#0a7ea4', 80], ['#e4572e', 40]]),
      4
    )
    expect(picked).toEqual({ primary: '#0a7ea4', secondary: '#e4572e' })
  })

  it('derives a darker secondary for a single-color logo', () => {
    const picked = pickRasterBrandColors(pixels([['#ffffff', 100], ['#0a7ea4', 50]]), 4)
    expect(picked?.primary).toBe('#0a7ea4')
    expect(picked?.secondary).not.toBe('#0a7ea4')
    expect(chroma(picked!.secondary).luminance()).toBeLessThan(chroma('#0a7ea4').luminance())
  })

  it('returns null for a fully transparent image', () => {
    expect(pickRasterBrandColors(pixels([['#000000', 20, 0]]), 4)).toBeNull()
  })
})
