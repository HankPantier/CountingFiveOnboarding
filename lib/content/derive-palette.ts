import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'
import { ensureTextContrast } from '@/lib/content/theme-css-generator'

// Logo → palette. Follows the LOGO, not colour theory:
//   - the page background is a near-white tinted with the brand hue (never grey),
//   - primary = the logo's deep brand colour (navy, maroon, plum, or its charcoal
//     when the only hue is a small accent),
//   - action = the logo's OWN second brand colour when it has one (Kinexus orange,
//     Buss red), else a curated harmonious accent for the primary's hue — never
//     the raw hue complement (which gave red logos cyan buttons),
//   - action is AA-corrected (4.5:1) against the page background, because the
//     template renders near-white button text on it.
// White/near-white/grey pixels, opaque background plates and transparent padding
// never count as brand colours. Pure; the palette route decodes the logo.

// Neutral brand defaults used when there is no logo, or extraction fails. The
// action is an AA teal (4.5:1 under near-white button text) — it used to be a
// magenta #DE00C1 that shipped as-is whenever an operator locked it unedited.
export const NEUTRAL_PALETTE: PaletteData = {
  primary:       { hex: '#231f20', name: 'Primary' },
  secondary:     { hex: '#098195', name: 'Secondary' },
  complementary: { hex: '#71003B', name: 'Complementary' },
  action:        { hex: '#007D8C', name: 'Action' },
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

// ── Tunables (OKLCH: L 0–1, C ≈ 0–0.37, h degrees) ──────────────────────────
const WHITE_L = 0.93          // L above this with little chroma = white/background
const WHITE_MAX_C = 0.05
const NEUTRAL_C = 0.03        // below = grey/black (not a hue)
const DARK_NEUTRAL_L = 0.5    // greys darker than this are a usable charcoal
const DEEP_L = 0.55           // a hue at or below this can carry light text as primary
const HUE_FAMILY_DEG = 25     // buckets within this hue distance are one colour
const DISTINCT_HUE_DEG = 35   // an accent must differ from the primary by this much
const MIN_FAMILY_SHARE = 0.03 // families under this share of brand pixels are noise
const DEEP_PRIMARY_SHARE = 0.2
const NEUTRAL_PRIMARY_SHARE = 0.1
const ACCENT_MIN_SHARE = 0.05
const LIGHT_LOGO_LUMINANCE = 0.6
const LIGHT_LOGO_SHARE = 0.6
const AA = 4.5
const ALPHA_MIN = 128
const QUANT_BITS = 4

export type WeightedColor = { hex: string; weight: number }

export type LogoBrandColors = {
  /** The primary brand colour (a real logo colour, or a constructed deep tone). */
  primary: string
  /** True when primary is the logo's charcoal/black rather than a hue. */
  primaryIsNeutral: boolean
  /** The logo's own second brand colour (raw), or null for a one-hue logo. */
  accent: string | null
  /** Most of the logo is white/light — it needs a dark surface behind it. */
  lightLogo: boolean
}

type Oklch = { l: number; c: number; h: number }

function oklch(hex: string): Oklch {
  const [l, c, h] = chroma(hex).oklch()
  return { l, c: Number.isNaN(c) ? 0 : c, h: Number.isNaN(h) ? 0 : h }
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

// OKLCH → hex, reducing chroma (binary search) until in sRGB gamut.
function fromOklch(l: number, c: number, h: number): string {
  const direct = chroma.oklch(l, c, h)
  if (!direct.clipped()) return direct.hex()
  let lo = 0
  let hi = c
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (chroma.oklch(l, mid, h).clipped()) hi = mid
    else lo = mid
  }
  return chroma.oklch(l, lo, h).hex()
}

// ── Pixel sampling ──────────────────────────────────────────────────────────

// Rank the colors in a raw pixel buffer by frequency. Pixels are bucketed by
// their top QUANT_BITS per channel; each bucket reports the AVERAGE of its
// pixels (not the bucket corner), so the returned hex is a real logo color.
// Mostly-transparent pixels (and any pixel the mask excludes) are skipped.
function bucketPixels(pixels: Uint8Array, channels: number, skip?: Uint8Array): WeightedColor[] {
  if (channels !== 3 && channels !== 4) return []
  const shift = 8 - QUANT_BITS
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0, p = 0; i + channels <= pixels.length; i += channels, p++) {
    if (channels === 4 && pixels[i + 3] < ALPHA_MIN) continue
    if (skip && skip[p]) continue
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
    .map((c) => ({
      hex: chroma(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)).hex().toLowerCase(),
      weight: c.n,
    }))
}

/** Frequency-ranked real colours of a raw RGB(A) buffer (transparent pixels skipped). */
export function rankPixelColors(pixels: Uint8Array, channels: number): string[] {
  return bucketPixels(pixels, channels).map((c) => c.hex)
}

const rgbDist = (px: Uint8Array, i: number, r: number, g: number, b: number): number =>
  Math.hypot(px[i] - r, px[i + 1] - g, px[i + 2] - b)

/**
 * Detect an opaque LIGHT background plate (a logo exported on a white/cream
 * box, e.g. Pryor, Buss) and return a mask of its pixels: flood-filled from the
 * image border over pixels close to the dominant border colour. Null when the
 * border is mostly transparent, mixed, or dark (a dark plate is brand colour).
 */
export function detectBackgroundPlate(
  pixels: Uint8Array,
  channels: number,
  width: number,
  height: number,
): { mask: Uint8Array; hex: string; share: number } | null {
  if ((channels !== 3 && channels !== 4) || width < 3 || height < 3) return null
  if (pixels.length < width * height * channels) return null
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
  const opaque = border.filter((p) => channels === 3 || pixels[p * channels + 3] >= ALPHA_MIN)
  if (opaque.length < border.length * 0.9) return null

  // Dominant border colour = the most common coarse bucket's average.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const p of opaque) {
    const i = p * channels
    const key = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4)
    const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bk.n++
    bk.r += pixels[i]
    bk.g += pixels[i + 1]
    bk.b += pixels[i + 2]
    buckets.set(key, bk)
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0]
  const r = top.r / top.n
  const g = top.g / top.n
  const b = top.b / top.n
  const matching = opaque.filter((p) => rgbDist(pixels, p * channels, r, g, b) <= 30)
  if (matching.length < border.length * 0.7) return null
  const hex = chroma(Math.round(r), Math.round(g), Math.round(b)).hex().toLowerCase()
  if (chroma(hex).luminance() < 0.5) return null

  const mask = new Uint8Array(width * height)
  const stack = [...matching]
  for (const p of matching) mask[p] = 1
  while (stack.length) {
    const p = stack.pop() as number
    const x = p % width
    const y = (p - x) / width
    const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]
    for (const q of next) {
      if (q < 0 || mask[q]) continue
      const i = q * channels
      if (channels === 4 && pixels[i + 3] < ALPHA_MIN) continue
      if (rgbDist(pixels, i, r, g, b) > 40) continue
      mask[q] = 1
      stack.push(q)
    }
  }
  let masked = 0
  for (let p = 0; p < mask.length; p++) masked += mask[p]
  return { mask, hex, share: masked / (width * height) }
}

/** Weighted colours of a raster logo with its background plate removed. */
export function sampleLogoPixels(
  pixels: Uint8Array,
  channels: number,
  width: number,
  height: number,
): { colors: WeightedColor[]; plate: { hex: string; share: number } | null } {
  const plate = detectBackgroundPlate(pixels, channels, width, height)
  return {
    colors: bucketPixels(pixels, channels, plate?.mask),
    plate: plate ? { hex: plate.hex, share: plate.share } : null,
  }
}

// ── Brand colour picking ────────────────────────────────────────────────────

type Family = { rep: string; repWeight: number; weight: number; lch: Oklch }

/**
 * Choose primary + accent from weighted logo colours (raster buckets or SVG
 * fill counts). Returns null when the logo has no usable colour at all (all
 * white/grey), so the caller falls back to NEUTRAL_PALETTE.
 */
export function pickLogoBrandColors(colors: WeightedColor[]): LogoBrandColors | null {
  const valid = colors.filter((c) => c.weight > 0 && chroma.valid(c.hex))
  const total = valid.reduce((s, c) => s + c.weight, 0)
  if (total === 0) return null

  let lightWeight = 0
  let darkNeutral: Family | null = null
  const families: Family[] = []
  for (const c of valid) {
    if (chroma(c.hex).luminance() > LIGHT_LOGO_LUMINANCE) lightWeight += c.weight
    const lch = oklch(c.hex)
    if (lch.l > WHITE_L && lch.c < WHITE_MAX_C) continue // white / background
    if (lch.c < NEUTRAL_C) {
      if (lch.l >= DARK_NEUTRAL_L) continue // mid/light grey: never a brand colour
      if (!darkNeutral) darkNeutral = { rep: c.hex, repWeight: c.weight, weight: 0, lch }
      darkNeutral.weight += c.weight
      continue
    }
    const fam = families.find((f) => hueDistance(f.lch.h, lch.h) <= HUE_FAMILY_DEG)
    if (fam) {
      fam.weight += c.weight
      if (c.weight > fam.repWeight) {
        fam.rep = c.hex
        fam.repWeight = c.weight
        fam.lch = lch
      }
    } else {
      families.push({ rep: c.hex, repWeight: c.weight, weight: c.weight, lch })
    }
  }
  const lightLogo = lightWeight / total >= LIGHT_LOGO_SHARE

  const brandWeight = families.reduce((s, f) => s + f.weight, 0) + (darkNeutral?.weight ?? 0)
  if (brandWeight === 0) return null
  const share = (w: number) => w / brandWeight
  const hues = families.filter((f) => share(f.weight) >= MIN_FAMILY_SHARE).sort((a, b) => b.weight - a.weight)
  const neutral = darkNeutral && share(darkNeutral.weight) >= NEUTRAL_PRIMARY_SHARE ? darkNeutral : null

  // Primary: the heaviest DEEP hue with real presence, else the logo's charcoal,
  // else the heaviest hue (deepened / replaced later if too light).
  const deep = hues.find((f) => f.lch.l <= DEEP_L && share(f.weight) >= DEEP_PRIMARY_SHARE)
  let primaryFam: Family | null = deep ?? null
  let primaryIsNeutral = false
  if (!primaryFam && neutral) {
    primaryFam = neutral
    primaryIsNeutral = true
  }
  if (!primaryFam) primaryFam = hues[0] ?? null
  if (!primaryFam) return null

  const accentFam = hues.find(
    (f) =>
      f !== primaryFam &&
      share(f.weight) >= ACCENT_MIN_SHARE &&
      (primaryIsNeutral || hueDistance(f.lch.h, primaryFam!.lch.h) >= DISTINCT_HUE_DEG),
  )
  return { primary: primaryFam.rep, primaryIsNeutral, accent: accentFam?.rep ?? null, lightLogo }
}

/** Primary + accent straight from a raw RGBA/RGB logo buffer (plate removed). */
export function pickRasterBrandColors(
  pixels: Uint8Array,
  channels: number,
  width: number,
  height: number,
): LogoBrandColors | null {
  return pickLogoBrandColors(sampleLogoPixels(pixels, channels, width, height).colors)
}

// ── Palette construction ────────────────────────────────────────────────────

// Curated accent hue (OKLCH) for a one-hue logo, keyed by the primary's hue.
// Harmonious, business-appropriate pairings — never the raw complement.
function curatedAccentHue(primaryHue: number, primaryIsNeutral: boolean): number {
  if (primaryIsNeutral) return 200 // teal
  const h = ((primaryHue % 360) + 360) % 360
  if (h < 40 || h >= 355) return 75 // red / maroon / crimson → gold
  if (h < 115) return 255 // orange / yellow → blue
  if (h < 170) return 70 // green → amber
  if (h < 220) return 40 // teal / cyan → coral
  if (h < 285) return 55 // blue / navy → orange
  return 195 // purple / plum / magenta → teal
}

const YELLOW_BAND: [number, number] = [85, 118]

// AA-correct an action colour against the page background (the template puts
// near-white text on it). Yellows darken to olive, so turn them gold first.
function actionFrom(hex: string, nearWhite: string): string {
  const lch = oklch(hex)
  let base = hex
  if (lch.c >= NEUTRAL_C && lch.h >= YELLOW_BAND[0] && lch.h <= YELLOW_BAND[1]) {
    base = fromOklch(Math.min(lch.l, 0.75), lch.c, 72)
  }
  return ensureTextContrast(base, nearWhite, AA).toLowerCase()
}

/**
 * Build the full 6-swatch palette from the picked logo colours:
 * primary (logo), secondary (the logo's second colour, or a deeper primary),
 * complementary (a soft brand-tinted accent surface), action (AA CTA colour),
 * and a brand-tinted near-black / near-white (L ≥ 96%) pair.
 */
export function buildLogoPalette(picked: LogoBrandColors): PaletteData {
  let primary = chroma.valid(picked.primary) ? chroma(picked.primary).hex().toLowerCase() : NEUTRAL_PALETTE.primary.hex
  let p = oklch(primary)
  let accent = picked.accent && chroma.valid(picked.accent) ? chroma(picked.accent).hex().toLowerCase() : null
  let primaryIsNeutral = picked.primaryIsNeutral

  // A primary too light to carry near-white text (a yellow or pastel logo, a
  // light-on-dark wordmark): yellows can't deepen without turning olive, so they
  // become the accent on a deep slate; other hues deepen in place.
  if (!primaryIsNeutral && p.l > DEEP_L) {
    const yellow = p.h >= YELLOW_BAND[0] - 20 && p.h <= YELLOW_BAND[1]
    if (yellow || p.c < 0.06) {
      accent = accent ?? primary
      primary = fromOklch(0.3, 0.04, 255)
    } else {
      primary = fromOklch(0.42, p.c, p.h)
    }
    p = oklch(primary)
  }

  if (primaryIsNeutral) {
    // The logo's charcoal, clamped to a usable deep ink and faintly tinted
    // toward the accent so it reads as a brand colour, not default black.
    const tintHue = accent ? oklch(accent).h : 250
    const l = Math.min(Math.max(p.l, 0.25), 0.38)
    primary = fromOklch(l, Math.max(p.c, 0.012), p.c >= 0.012 ? p.h : tintHue)
    p = oklch(primary)
  }
  primaryIsNeutral = primaryIsNeutral || p.c < NEUTRAL_C

  const accentHue = accent ? oklch(accent).h : curatedAccentHue(p.h, primaryIsNeutral)
  const tintHue = primaryIsNeutral ? accentHue : p.h

  const nearWhite = fromOklch(0.985, 0.006, tintHue).toLowerCase()
  const nearBlack = fromOklch(0.21, Math.min(0.02, Math.max(p.c * 0.25, 0.008)), p.h || tintHue).toLowerCase()
  const actionSource = accent ?? fromOklch(0.58, 0.15, accentHue)
  const action = actionFrom(actionSource, nearWhite)
  const secondary = (accent ?? fromOklch(Math.max(p.l - 0.12, 0.2), p.c, p.h)).toLowerCase()
  const complementary = fromOklch(0.93, primaryIsNeutral ? 0.025 : 0.035, tintHue).toLowerCase()

  return {
    primary:       { hex: primary, name: 'Primary' },
    secondary:     { hex: secondary, name: 'Secondary' },
    complementary: { hex: complementary, name: 'Complementary' },
    action:        { hex: action, name: 'Action' },
    nearBlack:     { hex: nearBlack, name: 'Text / Dark' },
    nearWhite:     { hex: nearWhite, name: 'Background / Light' },
  }
}

/**
 * Back-compat entry: a palette from an explicit primary + secondary brand
 * colour. The secondary becomes the action source when its hue is distinct.
 */
export function derivePalette(primaryInput: string, secondaryInput: string): PaletteData {
  if (!chroma.valid(primaryInput)) return structuredClone(NEUTRAL_PALETTE)
  const primary = chroma(primaryInput).hex()
  const secondary = chroma.valid(secondaryInput) ? chroma(secondaryInput).hex() : null
  const p = oklch(primary)
  const distinct =
    secondary !== null &&
    oklch(secondary).c >= NEUTRAL_C &&
    (p.c < NEUTRAL_C || hueDistance(oklch(secondary).h, p.h) >= DISTINCT_HUE_DEG)
  return buildLogoPalette({
    primary,
    primaryIsNeutral: p.c < NEUTRAL_C,
    accent: distinct ? secondary : null,
    lightLogo: false,
  })
}
