// The JSON contract emitted to the deliverable zip as `design.json`. Consumed
// by the Phase II client-site template's theme generator and PageLayout.
// Distinct from `design.md` (token YAML + narrative for coding agents).

import type { Roundness, Density, VisualFeel } from './design-tokens'

export type DesignJson = {
  typography: {
    headingFont: string
    bodyFont: string
    googleFontsUrl: string  // ready-to-embed <link> href
  }
  roundness: Roundness
  density: Density
  visualFeel: VisualFeel
  spacing: {
    xs: string
    sm: string
    md: string
    lg: string
    xl: string
    '2xl': string
  }
  radius: {
    none: string
    sm: string
    md: string
    lg: string
    pill: string
  }
}
