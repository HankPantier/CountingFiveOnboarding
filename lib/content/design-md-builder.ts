import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens, Roundness, Density } from '@/types/design-tokens'
import type { SessionSchema } from '@/types/session-schema'
import { findPairing, type TypePairingFeel } from './type-pairing-catalog'

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

function buildOverview(input: BuilderInput): string {
  const { firmName, brand, business, location, tokens } = input
  const locPart = location?.city
    ? ` in ${location.city}${location.state ? ', ' + location.state : ''}`
    : ''
  const foundedPart = business?.foundingYear ? ` founded ${business.foundingYear}` : ''
  const aspirational = brand?.aspirationalTone?.trim()
    ? `should feel **${brand.aspirationalTone.trim()}**`
    : 'should feel measured, trustworthy, and clear'
  const personality = brand?.brandPersonality?.trim()
    ? ` ${brand.brandPersonality.trim()}`
    : ''
  const feelLine: Record<typeof tokens.visualFeel, string> = {
    classic: 'Visual direction is classic: restrained typography, sturdy structure, considered detailing.',
    modern: 'Visual direction is modern: clean type, generous whitespace, confident accents.',
    editorial: 'Visual direction is editorial: serif headlines, considered hierarchy, room for long reads.',
  }
  return `## Overview

${firmName}${locPart}${foundedPart} ${aspirational}.${personality}

${feelLine[tokens.visualFeel]}`
}

function buildColorsSection(input: BuilderInput): string {
  const { palette } = input
  return `## Colors

The palette is rooted in **${palette.primary.name}** as the structural primary and **${palette.action.name}** as the action color used sparingly for CTAs. Near-black (${palette.nearBlack.hex}) and near-white (${palette.nearWhite.hex}) provide high-contrast surface pairings. The complementary accent (${palette.complementary.hex}) is reserved for badges and visual punctuation — never large fills.`
}

function buildTypographySection(input: BuilderInput): string {
  const pairing = findPairing(input.tokens.typePairing.id)
  const blurb: Record<TypePairingFeel, string> = {
    modern: 'A clean, neutral sans throughout favors clarity over decoration. Tight letter-spacing on headlines keeps the typography editorial without feeling cold.',
    editorial: 'Serif headlines pair with a humanist sans body. The combination gives long-form pages (About, Services) a considered, journalistic weight.',
    classic: 'High-contrast classic typography signals authority and continuity. Use sparingly on headlines; let the sans body do the reading work.',
    warm: 'Rounded forms throughout give the typography an approachable, human feel. Body sizes step up to 1rem for comfortable long-form reading.',
  }
  return `## Typography

${pairing?.headingFont ?? 'Heading font'} for headlines, ${pairing?.bodyFont ?? 'body font'} for body copy. ${pairing ? blurb[pairing.feel] : ''}`
}

function buildLayoutSection(input: BuilderInput): string {
  const density: Record<typeof input.tokens.density, string> = {
    tight: 'Spacing scale is **tight**: 16px unit, 32px between sections at md+, 64px max. Suits dense, content-heavy pages.',
    balanced: 'Spacing scale is **balanced**: 16px unit, 48px section gutter, 96px between major sections. Default for marketing layouts.',
    airy: 'Spacing scale is **airy**: 16px unit, 64px section gutter, 128px between major sections. Generous whitespace; reads as confident.',
  }
  return `## Layout

${density[input.tokens.density]} Container max-width 1200px. Single-column on mobile, two-column at md+.`
}

function buildElevationSection(): string {
  return `## Elevation & Depth

Use navy-tinted shadows, not pure black. At rest: \`0 1px 2px rgba(0, 59, 113, 0.08)\` for cards. On hover or raised state: \`0 8px 24px rgba(0, 59, 113, 0.12)\`. Avoid deep drop shadows; the system reads as flat-with-lift, not skeuomorphic.`
}

function buildShapesSection(input: BuilderInput): string {
  const r: Record<typeof input.tokens.roundness, string> = {
    sharp: 'Sharp 4px corners throughout signal precision and tradition. Buttons share the same 4px radius — no pill shapes.',
    soft: 'Soft 8px corners give the system a current, approachable feel without going soft. Cards and inputs use 8px; buttons use the pill scale.',
    pill: 'Full pill buttons (9999px) anchor the interactive language. Cards and inputs at 8px keep the rest of the system grounded.',
  }
  return `## Shapes

${r[input.tokens.roundness]} Badges always use the smallest scale (4px) for typographic anchoring.`
}

function buildComponentsSection(): string {
  return `## Components

Button-primary is the action color with on-action text and pill (or roundness-scaled) corners. On hover it shifts to the primary color. Button-secondary inverts: white surface, primary text, same shape. Cards sit on near-white with a soft navy-tinted shadow. Links use the action color and are always underlined within body copy. Badge uses the complementary accent at the smallest radius. Hero blocks fill with the primary color and use the largest spacing scale.`
}

function buildDosDontsSection(input: BuilderInput): string {
  const { tokens, brand } = input
  const feelDo: Record<typeof tokens.visualFeel, string> = {
    classic: 'Keep typography restrained — let structural choices carry the brand',
    modern: 'Keep hero copy short — let typography and whitespace carry the weight',
    editorial: 'Use serif headlines for long-form pages; reserve sans for UI chrome',
  }
  const avoidWords = (brand?.toneToAvoid ?? [])
    .map(w => (typeof w === 'string' ? w.trim() : ''))
    .filter(w => w.length > 0)
  const avoidLine = avoidWords.length > 0
    ? `\n- Don't use words from the firm's avoid list: ${avoidWords.map(w => `"${w.replace(/"/g, '\\"')}"`).join(', ')}`
    : ''

  return `## Do's and Don'ts

**Do**
- Use the action color for one CTA per screen
- ${feelDo[tokens.visualFeel]}
- Pair CTAs against high-contrast backgrounds

**Don't**
- Don't put the action color on the primary background
- Don't use generic black shadows
- Don't introduce a third heading font${avoidLine}`
}

export function buildDesignMd(input: BuilderInput): string {
  const pairing = findPairing(input.tokens.typePairing.id)
  const fontsUrl = pairing?.googleFontsUrl ?? ''
  const front = buildYamlFrontMatter(input, fontsUrl)

  const sections = [
    front,
    '',
    buildOverview(input),
    '',
    buildColorsSection(input),
    '',
    buildTypographySection(input),
    '',
    buildLayoutSection(input),
    '',
    buildElevationSection(),
    '',
    buildShapesSection(input),
    '',
    buildComponentsSection(),
    '',
    buildDosDontsSection(input),
  ]
  return sections.join('\n') + '\n'
}
