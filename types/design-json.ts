// The JSON contract emitted to the deliverable zip as `design.json`. Consumed
// by the Phase II client-site template's theme generator and PageLayout.
// Distinct from `design.md` (token YAML + narrative for coding agents).

import type { Roundness, Density, VisualFeel } from './design-tokens'

export type DesignJson = {
  typography: {
    headingFont: string
    bodyFont: string
    googleFontsUrl: string  // ready-to-embed <link> href
    accentFont: string      // italic-serif accent role (Ink & Clay); Fraunces default
  }
  roundness: Roundness
  density: Density
  visualFeel: VisualFeel
  /** Opt-in Revaltus-corporate treatments. Each defaults to the current look, so
   * a design.json without these fields renders exactly as before. Read by the
   * template's layout.tsx to set <html data-headline> / <html data-eyebrow>; the
   * dark-section token is always emitted and gated by darkSections at use-site. */
  headlineStyle?: 'sans' | 'serif'
  eyebrowStyle?: 'standard' | 'mono'
  darkSections?: boolean
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
