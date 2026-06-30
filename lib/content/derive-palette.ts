import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'

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
// (node-vibrant) and SVG-markup extraction paths.
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
