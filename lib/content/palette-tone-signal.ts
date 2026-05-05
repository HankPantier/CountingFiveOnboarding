import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'

export function derivePaletteToneSignal(palette: PaletteData | null): string {
  if (!palette) return ''

  const primary = palette.primary.hex
  const nearBlack = palette.nearBlack.hex
  const nearWhite = palette.nearWhite.hex

  try {
    const temp = chroma(primary).temperature()
    const contrast = chroma.contrast(nearBlack, nearWhite)

    if (contrast > 10) {
      return 'The brand uses high-contrast colors — copy can be bold and direct.'
    }

    // temperature() returns higher values for warm colors (reds/oranges/yellows)
    // and lower values for cool colors (blues/greens)
    if (temp > 5000) {
      return 'The brand palette is warm and energetic — copy should feel approachable and action-oriented.'
    }

    return 'The brand palette is cool and professional — copy should feel trustworthy and measured.'
  } catch {
    return ''
  }
}
