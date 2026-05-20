import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'
import type { SessionSchema } from '@/types/session-schema'

/**
 * Derive a visual-style suffix to append to every Pexels search query for a
 * given client. The goal is consistent aesthetic across all hero/content
 * images on a single site — same lighting, same mood, same color temperature
 * — even though each individual page has different subject matter.
 *
 * Claude emits SUBJECT-only queries (e.g., "tax season paperwork accountant")
 * during content generation. At deliverable assembly, the builder calls this
 * function once per content-job to derive a single suffix string, then
 * appends it to every subject query before sending to Pexels:
 *
 *   final = subject + ", " + suffix
 *   "tax season paperwork accountant, professional corporate photography, cool tone, modern office"
 *
 * Inputs: locked palette + brand voice signals captured during onboarding.
 *
 * Logic, in order of confidence:
 *   1. Always base on "professional photography" — these are CPA-firm
 *      marketing sites, not lifestyle/editorial.
 *   2. Palette temperature → "warm tone" / "cool tone" / (omit if neutral)
 *   3. Palette saturation → "vibrant" / "muted" / (omit if mid-saturation)
 *   4. Brand tone keywords → map a small set of recognized tones
 *      ("modern", "traditional", "approachable", "boutique") to image
 *      modifiers ("modern office", "classic professional", "warm lifestyle",
 *      "premium boutique"). Skip unrecognized tone words to avoid noise.
 *
 * Pure and never throws.
 */
export function deriveImageStyleSuffix(
  palette: PaletteData | null,
  brand: SessionSchema['brand'] | undefined
): string {
  const parts: string[] = ['professional photography']

  if (palette) {
    try {
      // Color temperature (chroma): returns standard CCT in Kelvin, so HIGH
      // values are blue/cool (daylight ~6500K) and LOW values are orange/warm
      // (tungsten ~2800K). Matching that convention, not visual intuition.
      const tempK = chroma(palette.primary.hex).temperature()
      if (tempK > 5500) parts.push('cool tone')
      else if (tempK < 4000) parts.push('warm tone')

      // Saturation of primary (HSL S in 0-1)
      const [, sat] = chroma(palette.primary.hex).hsl()
      if (!isNaN(sat)) {
        if (sat > 0.7) parts.push('vibrant')
        else if (sat < 0.25) parts.push('muted')
      }
    } catch {
      // Chroma threw on a malformed hex — skip palette modifiers
    }
  }

  // Map known tone adjectives to image-search-friendly modifiers. Restrict to
  // a small allowlist; adding e.g. "fun" as-is to a Pexels query reliably
  // returns the wrong results for a CPA site.
  const toneMap: Record<string, string> = {
    modern: 'modern office',
    contemporary: 'modern office',
    traditional: 'classic professional',
    classic: 'classic professional',
    approachable: 'warm lifestyle',
    friendly: 'warm lifestyle',
    boutique: 'premium boutique',
    bespoke: 'premium boutique',
    minimalist: 'minimalist clean',
    minimal: 'minimalist clean',
    editorial: 'editorial style',
    corporate: 'corporate',
  }

  const tones = (brand?.toneAdjectives ?? [])
    .map(t => t.toLowerCase().trim())
    .filter(Boolean)

  const matched = new Set<string>()
  for (const t of tones) {
    const mapped = toneMap[t]
    if (mapped && !matched.has(mapped)) matched.add(mapped)
  }
  // Cap at 2 mapped tone modifiers — beyond that, queries get over-specified
  // and Pexels results become very narrow or empty.
  for (const m of Array.from(matched).slice(0, 2)) parts.push(m)

  return parts.join(', ')
}
