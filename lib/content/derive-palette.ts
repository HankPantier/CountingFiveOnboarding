import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'
import { pickBrandColors } from '@/lib/content/svg-colors'

// Neutral brand defaults used when there is no logo, or extraction fails.
export const NEUTRAL_PALETTE: PaletteData = {
  primary:       { hex: '#231f20', name: 'Primary' },
  secondary:     { hex: '#098195', name: 'Secondary' },
  complementary: { hex: '#71003B', name: 'Complementary' },
  action:        { hex: '#DE00C1', name: 'Action' },
  nearBlack:     { hex: '#1A1A2E', name: 'Text / Dark' },
  nearWhite:     { hex: '#F5F7FA', name: 'Background / Light' },
}

// Loop darken/brighten until the dark/light pair clears WCAG AA (4.5:1).
export function ensureContrast(dark: string, light: string): { dark: string; light: string } {
  let d = dark
  let l = light
  let attempts = 0
  while (chroma.contrast(d, l) < 4.5 && attempts < 20) {
    d = chroma(d).darken(0.3).hex()
    l = chroma(l).brighten(0.3).hex()
    attempts++
  }
  return { dark: d, light: l }
}

// Builds the full 6-swatch palette from a primary + secondary brand color,
// deriving complementary (opposite hue), action (saturated/brightened), and
// WCAG-AA-safe near-black / near-white neutrals. Shared by the raster
// (sharp pixel sampling) and SVG-markup extraction paths.
export function derivePalette(primaryInput: string, secondaryInput: string): PaletteData {
  const primary = chroma.valid(primaryInput) ? chroma(primaryInput).hex() : NEUTRAL_PALETTE.primary.hex
  const secondary = chroma.valid(secondaryInput) ? chroma(secondaryInput).hex() : NEUTRAL_PALETTE.secondary.hex

  const hue = chroma(primary).get('hsl.h')
  const complementary = Number.isNaN(hue)
    ? primary
    : chroma(primary).set('hsl.h', (hue + 180) % 360).hex()
  const action = chroma(complementary).saturate(1).brighten(0.5).hex()

  const { dark: nearBlack, light: nearWhite } = ensureContrast(
    chroma(primary).darken(2.5).desaturate(0.3).hex(),
    chroma(secondary).brighten(3).desaturate(1.5).hex(),
  )

  return {
    primary:       { hex: primary, name: 'Primary' },
    secondary:     { hex: secondary, name: 'Secondary' },
    complementary: { hex: complementary, name: 'Complementary' },
    action:        { hex: action, name: 'Action' },
    nearBlack:     { hex: nearBlack, name: 'Text / Dark' },
    nearWhite:     { hex: nearWhite, name: 'Background / Light' },
  }
}

// ── Raster logo sampling (pure) ─────────────────────────────────────────────
// The palette route decodes a raster logo with sharp into raw RGBA pixels
// (downscaled) and hands them here. Replaces node-vibrant.

// Bits kept per channel when bucketing. 4 bits → 4096 buckets: coarse enough
// to merge anti-aliasing noise into its parent color, fine enough to keep
// distinct brand colors apart.
const QUANT_BITS = 4
const ALPHA_MIN = 128

// Rank the colors in a raw pixel buffer by frequency. Pixels are bucketed by
// their top QUANT_BITS per channel; each bucket reports the AVERAGE of its
// pixels (not the bucket corner), so the returned hex is a real logo color.
// Mostly-transparent pixels are skipped. `channels` is 3 (RGB) or 4 (RGBA).
export function rankPixelColors(pixels: Uint8Array, channels: number): string[] {
  if (channels !== 3 && channels !== 4) return []
  const shift = 8 - QUANT_BITS
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + channels <= pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] < ALPHA_MIN) continue
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const key = ((r >> shift) << (QUANT_BITS * 2)) | ((g >> shift) << QUANT_BITS) | (b >> shift)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.n++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { n: 1, r, g, b })
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .map((c) => chroma(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)).hex().toLowerCase())
}

// Primary + secondary brand colors from raw pixels, or null when the image has
// no opaque pixels. Uses the same saturated/hue-distinct picker as the SVG
// path; a single-color logo gets a darkened primary as its secondary (the old
// DarkVibrant fallback).
export function pickRasterBrandColors(
  pixels: Uint8Array,
  channels: number
): { primary: string; secondary: string } | null {
  const picked = pickBrandColors(rankPixelColors(pixels, channels))
  if (!picked) return null
  const secondary =
    picked.secondary === picked.primary ? chroma(picked.primary).darken(1.5).hex() : picked.secondary
  return { primary: picked.primary, secondary }
}
