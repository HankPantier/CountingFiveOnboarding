import { describe, expect, it } from 'vitest'
import chroma from 'chroma-js'
import {
  buildLogoPalette,
  derivePalette,
  detectBackgroundPlate,
  ensureContrast,
  NEUTRAL_PALETTE,
  pickLogoBrandColors,
  pickRasterBrandColors,
  rankPixelColors,
  sampleLogoPixels,
  type WeightedColor,
} from './derive-palette'
import samples from './__fixtures__/logo-color-samples.json'

// Colour samples of the 8 stored managed-client logos, taken exactly as the
// palette route samples them (128px, RGBA, background plate removed; buckets
// with weight >= 2). Colours only — no client images live in the repo.
type Sample = { plate: string | null; colors: Array<Array<string | number>> }
const LOGOS: Record<string, Sample> = samples
const weighted = (name: string): WeightedColor[] =>
  LOGOS[name].colors.map(([hex, weight]) => ({ hex: String(hex), weight: Number(weight) }))
const paletteFor = (name: string) => {
  const picked = pickLogoBrandColors(weighted(name))
  if (!picked) throw new Error(`no colours for ${name}`)
  return { picked, palette: buildLogoPalette(picked) }
}
const hue = (hex: string) => chroma(hex).oklch()[2]
const hslL = (hex: string) => chroma(hex).get('hsl.l') * 100

describe('derivePalette golden: the 8 stored client logos', () => {
  // [logo, expected primary, expected logo accent (null = one-hue logo), light logo]
  const GOLDEN: Array<[string, string, string | null, boolean]> = [
    ['kinexus', '#12284c', '#ff6c0d', false], // navy is the brand, orange the accent (was: orange primary)
    ['buss', '#272727', '#d32827', false], // charcoal + red; the white plate is ignored (was: cyan action)
    ['accord', '#3a3a3c', '#a31e37', false], // charcoal + crimson (was: mint action, grey page)
    ['abramson', '#782223', null, false], // maroon; the grey wordmark is not a brand colour
    ['bblcpa', '#003768', null, false], // navy
    ['pryor', '#964876', null, false], // the plum tree, not the white plate (was: near-white primary)
    ['berg', '#fdec55', null, true], // white wordmark + yellow bulb → light logo
    ['aurora', '#595a5c', '#ee589a', false], // grey wordmark + multicolour lotus
  ]

  it.each(GOLDEN)('%s picks primary %s, accent %s', (name, primary, accent, light) => {
    const { picked } = paletteFor(name)
    expect(picked.primary).toBe(primary)
    expect(picked.accent).toBe(accent)
    expect(picked.lightLogo).toBe(light)
  })

  it.each(Object.keys(LOGOS))('%s: near-white page (L >= 96, never grey), AA button + text pairs', (name) => {
    const { palette } = paletteFor(name)
    expect(hslL(palette.nearWhite.hex)).toBeGreaterThanOrEqual(96)
    expect(chroma.contrast(palette.nearBlack.hex, palette.nearWhite.hex)).toBeGreaterThanOrEqual(7)
    // The template puts near-white text on the action colour, and uses it as link text.
    expect(chroma.contrast(palette.action.hex, palette.nearWhite.hex)).toBeGreaterThanOrEqual(4.5)
  })

  it('uses the logo accent as the action colour (AA-darkened when needed)', () => {
    expect(paletteFor('buss').palette.action.hex).toBe('#d32827') // already AA → unchanged
    expect(paletteFor('accord').palette.action.hex).toBe('#a31e37')
    const kinexus = paletteFor('kinexus').palette.action.hex
    expect(Math.abs(hue(kinexus) - hue('#ff6c0d'))).toBeLessThan(3) // still the logo orange, deepened
  })

  it('never uses the hue complement: red/maroon logos get a warm gold, not cyan', () => {
    const action = paletteFor('abramson').palette.action.hex
    expect(hue(action)).toBeGreaterThan(55)
    expect(hue(action)).toBeLessThan(95)
  })

  it('puts a light logo on a deep primary and moves its colour to the action (Berg)', () => {
    const { palette } = paletteFor('berg')
    expect(chroma(palette.primary.hex).oklch()[0]).toBeLessThan(0.4)
    expect(palette.secondary.hex).toBe('#fdec55')
    expect(hue(palette.action.hex)).toBeGreaterThan(55) // gold, not olive
    expect(hue(palette.action.hex)).toBeLessThan(90)
  })

  it('tints a charcoal primary faintly instead of shipping flat black', () => {
    const { palette } = paletteFor('buss')
    const [l, c] = chroma(palette.primary.hex).oklch()
    expect(l).toBeGreaterThanOrEqual(0.24)
    expect(l).toBeLessThanOrEqual(0.39)
    expect(c).toBeGreaterThan(0.005)
  })
})

describe('buildLogoPalette / derivePalette', () => {
  it('curates an accent for a one-hue logo (navy → warm orange)', () => {
    const p = derivePalette('#0a3d7a', '#0a3d7a')
    expect(p.primary.hex).toBe('#0a3d7a')
    const h = hue(p.action.hex)
    expect(h).toBeGreaterThan(30)
    expect(h).toBeLessThan(80)
  })

  it('treats a hue-distinct secondary as the action source', () => {
    const p = derivePalette('#0a3d7a', '#e4572e')
    expect(Math.abs(hue(p.action.hex) - hue('#e4572e'))).toBeLessThan(3)
  })

  it('deepens a light, non-yellow primary so it can carry light text', () => {
    const p = buildLogoPalette({ primary: '#6fb3ff', primaryIsNeutral: false, accent: null, lightLogo: false })
    expect(chroma.contrast(p.primary.hex, p.nearWhite.hex)).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to neutral hexes for invalid input', () => {
    const p = derivePalette('not-a-color', '')
    expect(p.primary.hex).toBe(NEUTRAL_PALETTE.primary.hex)
    expect(chroma.contrast(p.action.hex, p.nearWhite.hex)).toBeGreaterThanOrEqual(4.5)
  })

  it('NEUTRAL_PALETTE action is teal, not magenta', () => {
    expect(NEUTRAL_PALETTE.action.hex.toLowerCase()).toBe('#007d8c')
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

// A w×h RGBA image: `fill` everywhere, `inner` in the centred box of size bw×bh.
function boxImage(w: number, h: number, fill: [string, number], inner: string, bw: number, bh: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  const [fr, fg, fb] = chroma(fill[0]).rgb()
  const [ir, ig, ib] = chroma(inner).rgb()
  const x0 = Math.floor((w - bw) / 2)
  const y0 = Math.floor((h - bh) / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inside = x >= x0 && x < x0 + bw && y >= y0 && y < y0 + bh
      out.set(inside ? [ir, ig, ib, 255] : [fr, fg, fb, fill[1]], i)
    }
  }
  return out
}

describe('rankPixelColors', () => {
  it('ranks by frequency and returns averaged real colors', () => {
    const ranked = rankPixelColors(pixels([['#0055aa', 10], ['#ff0000', 30]]), 4)
    expect(ranked[0]).toBe('#ff0000')
    expect(ranked[1]).toBe('#0055aa')
  })

  it('merges near-identical (anti-aliased) shades into one bucket', () => {
    expect(rankPixelColors(pixels([['#ff0000', 10], ['#fe0101', 10]]), 4)).toHaveLength(1)
  })

  it('skips transparent pixels and handles RGB input', () => {
    expect(rankPixelColors(pixels([['#ff0000', 5, 0]]), 4)).toEqual([])
    expect(rankPixelColors(Uint8Array.from([0, 0, 255, 0, 0, 255]), 3)).toEqual(['#0000ff'])
    expect(rankPixelColors(Uint8Array.from([1, 2]), 2)).toEqual([])
  })
})

describe('detectBackgroundPlate / sampleLogoPixels', () => {
  it('masks an opaque white plate so it never counts as a colour', () => {
    const img = boxImage(20, 10, ['#ffffff', 255], '#0a3d7a', 8, 4)
    const plate = detectBackgroundPlate(img, 4, 20, 10)
    expect(plate?.hex).toBe('#ffffff')
    expect(plate!.share).toBeCloseTo(1 - 32 / 200, 2)
    expect(sampleLogoPixels(img, 4, 20, 10).colors.map((c) => c.hex)).toEqual(['#0a3d7a'])
  })

  it('finds no plate on a transparent logo or a dark (brand-colour) plate', () => {
    expect(detectBackgroundPlate(boxImage(20, 10, ['#000000', 0], '#0a3d7a', 8, 4), 4, 20, 10)).toBeNull()
    expect(detectBackgroundPlate(boxImage(20, 10, ['#12284c', 255], '#ffffff', 8, 4), 4, 20, 10)).toBeNull()
  })

  it('pickRasterBrandColors ignores the plate and light greys', () => {
    const img = boxImage(20, 10, ['#ffffff', 255], '#0a7ea4', 8, 4)
    expect(pickRasterBrandColors(img, 4, 20, 10)?.primary).toBe('#0a7ea4')
  })

  it('returns null for a fully transparent or all-grey image', () => {
    expect(pickRasterBrandColors(pixels([['#000000', 20, 0]]), 4, 20, 1)).toBeNull()
    expect(pickLogoBrandColors([{ hex: '#bbbbbb', weight: 10 }, { hex: '#ffffff', weight: 50 }])).toBeNull()
  })

  it('flags a light-on-transparent logo', () => {
    const picked = pickLogoBrandColors([{ hex: '#ffffff', weight: 80 }, { hex: '#fdec55', weight: 20 }])
    expect(picked?.lightLogo).toBe(true)
  })
})
