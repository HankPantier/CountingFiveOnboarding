import type { PaletteData } from '@/types/palette'
import type { DesignTokens } from '@/types/design-tokens'

/**
 * Neutral-professional brand/design values for scripts and tests. NOT used by
 * packaging any more: assembleContentPackage refuses a job without a locked
 * palette + tokens (lib/content/brand-gate.ts) instead of shipping these —
 * silently shipping them is how most live sites ended up unbranded. The colours
 * are AA-contrast-safe and deliberately generic.
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
