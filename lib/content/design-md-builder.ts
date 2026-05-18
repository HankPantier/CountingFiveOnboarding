import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens, Roundness, Density } from '@/types/design-tokens'
import type { SessionSchema } from '@/types/session-schema'
import { findPairing } from './type-pairing-catalog'

type BuilderInput = {
  firmName: string
  palette: PaletteData
  tokens: DesignTokens
  brand: SessionSchema['brand'] | undefined
  business: SessionSchema['business'] | undefined
  location: { city: string; state: string } | null
}

function yamlEscape(s: string): string {
  // Escape backslash first, then double-quote — order matters.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function pillValue(r: Roundness): string {
  return r === 'sharp' ? '4px' : r === 'soft' ? '8px' : '9999px'
}

function densitySpacing(d: Density): { xl: string; '2xl': string } {
  if (d === 'tight') return { xl: '32px', '2xl': '64px' }
  if (d === 'airy') return { xl: '64px', '2xl': '128px' }
  return { xl: '48px', '2xl': '96px' }
}

function onColor(base: string, nearWhite: string, nearBlack: string): string {
  // WCAG AA threshold is 4.5. Prefer nearWhite, fall back to nearBlack.
  try {
    const cw = chroma.contrast(base, nearWhite)
    const cb = chroma.contrast(base, nearBlack)
    if (cw >= 4.5) return nearWhite
    if (cb >= 4.5) return nearBlack
    return cw >= cb ? nearWhite : nearBlack
  } catch {
    return nearWhite
  }
}

function buildYamlFrontMatter(input: BuilderInput, fontsUrl: string): string {
  const { firmName, palette, tokens } = input
  const heading = tokens.typePairing.headingFont
  const body = tokens.typePairing.bodyFont
  const onAction = onColor(palette.action.hex, palette.nearWhite.hex, palette.nearBlack.hex)
  const onPrimary = onColor(palette.primary.hex, palette.nearWhite.hex, palette.nearBlack.hex)
  const sp = densitySpacing(tokens.density)
  const pill = pillValue(tokens.roundness)

  return `<!-- Fonts: ${fontsUrl} -->
---
version: alpha
name: "${yamlEscape(firmName)}"
description: "Design system for the ${yamlEscape(firmName)} website rebuild."
colors:
  primary: "${palette.primary.hex}"
  secondary: "${palette.secondary.hex}"
  complementary: "${palette.complementary.hex}"
  action: "${palette.action.hex}"
  near-black: "${palette.nearBlack.hex}"
  near-white: "${palette.nearWhite.hex}"
  on-action: "${onAction}"
  on-primary: "${onPrimary}"
typography:
  h1:
    fontFamily: "${heading}"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "${heading}"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  body-md:
    fontFamily: "${body}"
    fontSize: "1rem"
    lineHeight: 1.6
  body-sm:
    fontFamily: "${body}"
    fontSize: "0.875rem"
  label-caps:
    fontFamily: "${heading}"
    fontSize: "0.75rem"
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "16px"
  pill: "${pill}"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "${sp.xl}"
  2xl: "${sp['2xl']}"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.near-white}"
  button-secondary:
    backgroundColor: "{colors.near-white}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  card:
    backgroundColor: "{colors.near-white}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  link:
    textColor: "{colors.action}"
  badge:
    backgroundColor: "{colors.complementary}"
    textColor: "{colors.near-white}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.near-white}"
    padding: "{spacing.2xl} {spacing.lg}"
  footer:
    backgroundColor: "{colors.near-black}"
    textColor: "{colors.near-white}"
---`
}

export function buildDesignMd(input: BuilderInput): string {
  const pairing = findPairing(input.tokens.typePairing.id)
  const fontsUrl = pairing?.googleFontsUrl ?? ''
  const front = buildYamlFrontMatter(input, fontsUrl)
  // Markdown body added in the next task.
  return front + '\n'
}
