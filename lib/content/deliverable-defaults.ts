import type { PaletteData } from '@/types/palette'
import type { DesignTokens } from '@/types/design-tokens'

/**
 * Last-resort fallbacks for the Phase II JSON contract. The downstream client
 * template *requires* content/brand.json and content/design.json — its
 * validate-deliverable script errors and generate-theme.ts crashes without
 * them. A session normally locks a palette + design tokens before content, but
 * if a package is assembled before that happens, we still emit a valid,
 * neutral-professional brand/design rather than ship a zip the template can't
 * consume. The colours are AA-contrast-safe and deliberately generic.
 */
export const FALLBACK_PALETTE: PaletteData = {
  primary: { hex: '#1F3A5F', name: 'Slate Navy' },
  secondary: { hex: '#5A6B7B', name: 'Slate Gray' },
  complementary: { hex: '#C2703D', name: 'Warm Clay' },
  action: { hex: '#0E8C9C', name: 'Teal' },
  nearBlack: { hex: '#1A1C1E', name: 'Near Black' },
  nearWhite: { hex: '#F8F8F6', name: 'Near White' },
}

export const FALLBACK_DESIGN_TOKENS: DesignTokens = {
  typePairing: { id: 'inter-inter', headingFont: 'Inter', bodyFont: 'Inter', label: 'Inter' },
  roundness: 'soft',
  density: 'balanced',
  visualFeel: 'modern',
}
