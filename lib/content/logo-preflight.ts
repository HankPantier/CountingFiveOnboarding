import sharp from 'sharp'
import { isLightLogo, sampleLogoPixels } from '@/lib/content/derive-palette'
import { extractSvgColorWeights } from '@/lib/content/svg-colors'

// Logo checks at package time (server-only: sharp). Before this, nothing looked
// at the logo before it shipped: Accord's PNG carried so much transparent
// padding it rendered 81px wide, Berg's white wordmark was invisible on the
// light header, and Pryor/Buss ship an opaque white box.

export type LogoPreflight = {
  /** The logo bytes to ship — trimmed when it had a lot of transparent padding. */
  buffer: Buffer
  trimmed: { from: string; to: string } | null
  /** Mostly white/light: needs a dark surface (inverted nav) to be visible. */
  lightLogo: boolean
  /**
   * Whether the pixels (or SVG colours) were actually examined. False for a
   * GIF, a multi-page image, unreadable metadata or a sharp failure: then
   * `lightLogo` is only the dark default, not a finding.
   */
  toneConclusive: boolean
  /** An opaque light background box baked into the image. */
  plate: { hex: string; share: number } | null
  /** Operator-facing notes for the Deliverables panel. */
  notes: string[]
}

// Trim only when the padding is substantial: at least this share of the width
// or height is empty border.
const MIN_TRIM_SHARE = 0.1
// A plate this large (share of the image) is worth telling the operator about.
const PLATE_NOTE_SHARE = 0.25

const noChange = (buffer: Buffer, lightLogo = false, toneConclusive = false): LogoPreflight => ({
  buffer,
  trimmed: null,
  lightLogo,
  toneConclusive,
  plate: null,
  notes: lightLogo ? [LIGHT_LOGO_NOTE] : [],
})

export const LIGHT_LOGO_NOTE =
  'The logo is mostly white/light, so it would disappear on the light header. A first deploy ships the inverted (primary-colour) navigation and flags the logo as light (brand.json logo.tone) so it shows in the header and footer; on a live site set "tone": "light" in brand.json’s logo (template 2026.09.6+) and switch Navigation to “inverted” in Theme Studio, or upload a dark version of the logo.'

/**
 * A white/light logo gets the inverted (primary-colour) nav so it is visible —
 * unless design.json already chose a nav style. Mutates and returns designJson.
 * design.json is first-deploy site config, so this never changes a live site.
 */
export function applyLogoNavDefault<T extends { style?: Record<string, string> }>(designJson: T, lightLogo: boolean): T {
  if (lightLogo && !designJson.style?.nav) designJson.style = { ...designJson.style, nav: 'inverted' }
  return designJson
}

/**
 * A white/light logo is flagged in brand.json as `logo.tone: "light"`, the
 * template's deterministic signal (2026.09.6, src/lib/brand/logo-tone.ts) to
 * drop the inverted nav's light plate, seat the logo on a dark plate on a light
 * nav, and stop inverting it in the dark footer. A dark logo gets no key, so
 * its site renders exactly as before. Mutates and returns the logo object.
 * brand.json is first-deploy site config, so this never changes a live site.
 */
export function applyLogoTone<T extends { tone?: 'light' | 'dark' }>(logo: T, lightLogo: boolean): T {
  if (lightLogo) logo.tone = 'light'
  return logo
}

/** Analyse (and, for padded transparent rasters, trim) the logo. Never throws. */
export async function preflightLogo(buffer: Buffer, fileName: string): Promise<LogoPreflight> {
  if (/\.svg$/i.test(fileName)) {
    return noChange(buffer, isLightLogo(extractSvgColorWeights(buffer.toString('utf-8'))), true)
  }
  try {
    const meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata()
    if (!meta.width || !meta.height || meta.format === 'svg' || meta.format === 'gif' || (meta.pages ?? 1) > 1) {
      return noChange(buffer)
    }

    let out = buffer
    let trimmed: LogoPreflight['trimmed'] = null
    if (meta.hasAlpha) {
      // Trim fully transparent borders only (background = transparent).
      const { data, info } = await sharp(buffer, { limitInputPixels: 50_000_000 })
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
        .toBuffer({ resolveWithObject: true })
      const cutW = 1 - info.width / meta.width
      const cutH = 1 - info.height / meta.height
      if (info.width > 0 && info.height > 0 && (cutW >= MIN_TRIM_SHARE || cutH >= MIN_TRIM_SHARE)) {
        out = data
        trimmed = { from: `${meta.width}×${meta.height}`, to: `${info.width}×${info.height}` }
      }
    }

    const { data: px, info: pi } = await sharp(out, { limitInputPixels: 50_000_000 })
      .resize(128, 128, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const sampled = sampleLogoPixels(px, pi.channels, pi.width, pi.height)
    const lightLogo = isLightLogo(sampled.colors)
    const plate = sampled.plate && sampled.plate.share >= PLATE_NOTE_SHARE ? sampled.plate : null

    const notes: string[] = []
    if (trimmed) {
      notes.push(`Logo trimmed from ${trimmed.from} to ${trimmed.to} px (transparent padding removed) so it renders at full size in the header.`)
    }
    if (lightLogo) notes.push(LIGHT_LOGO_NOTE)
    if (plate) {
      notes.push(
        `The logo has an opaque ${plate.hex} background box (${Math.round(plate.share * 100)}% of the image). It shows as a box on tinted or dark surfaces such as the footer — ask the client for a transparent PNG or an SVG.`,
      )
    }
    return { buffer: out, trimmed, lightLogo, toneConclusive: true, plate, notes }
  } catch (err) {
    console.warn(`[package] Logo preflight skipped for ${fileName}:`, err)
    return noChange(buffer)
  }
}
