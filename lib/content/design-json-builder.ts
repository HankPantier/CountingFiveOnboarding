import type { DesignTokens, Roundness, Density } from '@/types/design-tokens'
import type { DesignJson } from '@/types/design-json'
import { findPairing } from './type-pairing-catalog'

function pillValue(r: Roundness): string {
  return r === 'sharp' ? '4px' : r === 'soft' ? '8px' : '9999px'
}

function densitySpacing(d: Density): { xl: string; '2xl': string } {
  if (d === 'tight') return { xl: '32px', '2xl': '64px' }
  if (d === 'airy') return { xl: '64px', '2xl': '128px' }
  return { xl: '48px', '2xl': '96px' }
}

export function buildDesignJson(tokens: DesignTokens): DesignJson {
  // Look up the type pairing. Fall back to tokens if lookup fails.
  const pairing = findPairing(tokens.typePairing.id)

  const headingFont = pairing?.headingFont ?? tokens.typePairing.headingFont
  const bodyFont = pairing?.bodyFont ?? tokens.typePairing.bodyFont
  const googleFontsUrl = pairing?.googleFontsUrl ?? ''

  // Derive spacing from density
  const densitySpacingValues = densitySpacing(tokens.density)

  // Derive radius values from roundness
  const pillRadius = pillValue(tokens.roundness)

  return {
    typography: {
      headingFont,
      bodyFont,
      googleFontsUrl,
    },
    roundness: tokens.roundness,
    density: tokens.density,
    visualFeel: tokens.visualFeel,
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '16px',
      lg: '24px',
      xl: densitySpacingValues.xl,
      '2xl': densitySpacingValues['2xl'],
    },
    radius: {
      none: '0px',
      sm: '4px',
      md: '8px',
      lg: '16px',
      pill: pillRadius,
    },
  }
}
