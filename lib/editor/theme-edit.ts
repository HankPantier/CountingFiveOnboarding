// Pure helpers for the AI theme editor's tools. They patch a client site's
// content/brand.json (palette) and content/design.json (roundness/spacing/
// radius) as text — parse, merge the requested fields, re-serialize in the
// repo's 2-space + trailing-newline JSON style — and validate the design-
// overrides.css append. theme.css is regenerated separately by the route via
// generateThemeCss(); these helpers only own the JSON source-of-truth files.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { CURATED_FONTS, gfUrl } from '@/lib/content/type-pairing-catalog'

const HEX_RE = /^#[0-9a-fA-F]{6}$/
export const PALETTE_ROLES = [
  'primary',
  'secondary',
  'complementary',
  'action',
  'nearBlack',
  'nearWhite',
] as const
export type PaletteRole = (typeof PALETTE_ROLES)[number]
export type PalettePatch = Partial<Record<PaletteRole, string>>

// A CSS length the token fields accept: px/rem/em/%/0/9999px etc. Kept strict so
// a token value can never smuggle arbitrary text into the generated theme.css.
const LENGTH_RE = /^(0|[0-9]+(\.[0-9]+)?(px|rem|em|%|vw|vh))$/
const SPACING_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const
const RADIUS_KEYS = ['none', 'sm', 'md', 'lg', 'pill'] as const
export type TokenPatch = {
  roundness?: DesignJson['roundness']
  density?: DesignJson['density']
  visualFeel?: DesignJson['visualFeel']
  spacing?: Partial<DesignJson['spacing']>
  radius?: Partial<DesignJson['radius']>
}

// Serialize JSON the way the deliverable writes it (2-space, trailing newline)
// so the diff stays minimal and matches patchBrandJsonContact's format.
function serialize(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n'
}

export type BrandPatchResult =
  | { ok: true; next: string; brand: BrandJson; changed: boolean }
  | { ok: false; reason: string }

// Merge a palette patch into brand.json text. Rejects any non-#rrggbb value so
// the emitted theme.css and brand tokens can never carry unvalidated color text.
export function patchBrandPalette(brandJsonText: string, patch: PalettePatch): BrandPatchResult {
  let brand: BrandJson
  try {
    brand = JSON.parse(brandJsonText) as BrandJson
  } catch {
    return { ok: false, reason: 'content/brand.json is not valid JSON.' }
  }
  if (!brand.palette) return { ok: false, reason: 'content/brand.json has no palette to edit.' }

  const entries = Object.entries(patch).filter(([, v]) => v != null) as [PaletteRole, string][]
  if (entries.length === 0) return { ok: false, reason: 'No palette changes were provided.' }

  for (const [role, hex] of entries) {
    if (!PALETTE_ROLES.includes(role)) return { ok: false, reason: `Unknown palette role: ${role}.` }
    if (!HEX_RE.test(hex)) return { ok: false, reason: `${role} must be a 6-digit hex color like #1a2b3c (got "${hex}").` }
  }

  const nextPalette = { ...brand.palette }
  for (const [role, hex] of entries) nextPalette[role] = hex.toLowerCase()
  const next: BrandJson = { ...brand, palette: nextPalette }
  const nextText = serialize(next)
  return { ok: true, next: nextText, brand: next, changed: nextText !== brandJsonText }
}

export type DesignPatchResult =
  | { ok: true; next: string; design: DesignJson; changed: boolean }
  | { ok: false; reason: string }

// Merge a token patch into design.json text. Validates every CSS length so a
// spacing/radius value can never inject arbitrary text into theme.css.
export function patchDesignTokens(designJsonText: string, patch: TokenPatch): DesignPatchResult {
  let design: DesignJson
  try {
    design = JSON.parse(designJsonText) as DesignJson
  } catch {
    return { ok: false, reason: 'content/design.json is not valid JSON.' }
  }

  const next: DesignJson = { ...design }
  let touched = false

  if (patch.roundness) {
    if (!['sharp', 'soft', 'pill'].includes(patch.roundness)) return { ok: false, reason: 'roundness must be sharp, soft, or pill.' }
    next.roundness = patch.roundness
    touched = true
  }
  if (patch.density) {
    if (!['tight', 'balanced', 'airy'].includes(patch.density)) return { ok: false, reason: 'density must be tight, balanced, or airy.' }
    next.density = patch.density
    touched = true
  }
  if (patch.visualFeel) {
    if (!['classic', 'modern', 'editorial'].includes(patch.visualFeel)) return { ok: false, reason: 'visualFeel must be classic, modern, or editorial.' }
    next.visualFeel = patch.visualFeel
    touched = true
  }
  if (patch.spacing) {
    const nextSpacing = { ...design.spacing }
    for (const [k, v] of Object.entries(patch.spacing)) {
      if (v == null) continue
      if (!SPACING_KEYS.includes(k as (typeof SPACING_KEYS)[number])) return { ok: false, reason: `Unknown spacing key: ${k}.` }
      if (!LENGTH_RE.test(v)) return { ok: false, reason: `spacing.${k} must be a CSS length like 16px or 1.5rem (got "${v}").` }
      nextSpacing[k as keyof DesignJson['spacing']] = v
      touched = true
    }
    next.spacing = nextSpacing
  }
  if (patch.radius) {
    const nextRadius = { ...design.radius }
    for (const [k, v] of Object.entries(patch.radius)) {
      if (v == null) continue
      if (!RADIUS_KEYS.includes(k as (typeof RADIUS_KEYS)[number])) return { ok: false, reason: `Unknown radius key: ${k}.` }
      if (!LENGTH_RE.test(v)) return { ok: false, reason: `radius.${k} must be a CSS length like 8px or 9999px (got "${v}").` }
      nextRadius[k as keyof DesignJson['radius']] = v
      touched = true
    }
    next.radius = nextRadius
  }

  if (!touched) return { ok: false, reason: 'No token changes were provided.' }
  const nextText = serialize(next)
  return { ok: true, next: nextText, design: next, changed: nextText !== designJsonText }
}

// ---------------------------------------------------------------------------
// Typography (fonts). Mirrors patchDesignTokens but for the font slots. Every
// font must be in the curated allow-list so an unvalidated family name can
// never smuggle arbitrary text into the rebuilt Google Fonts URL.
// ---------------------------------------------------------------------------
export type TypographyPatch = {
  headingFont?: string
  bodyFont?: string
  accentFont?: string
}

export function patchDesignTypography(designJsonText: string, patch: TypographyPatch): DesignPatchResult {
  let design: DesignJson
  try {
    design = JSON.parse(designJsonText) as DesignJson
  } catch {
    return { ok: false, reason: 'content/design.json is not valid JSON.' }
  }

  const entries = Object.entries(patch).filter(([, v]) => v != null) as [keyof TypographyPatch, string][]
  if (entries.length === 0) return { ok: false, reason: 'No font changes were provided.' }
  for (const [slot, font] of entries) {
    if (!CURATED_FONTS.includes(font)) {
      return { ok: false, reason: `Unknown font "${font}" for ${slot}. Choose one from the curated list.` }
    }
  }

  const typography = { ...design.typography }
  for (const [slot, font] of entries) typography[slot] = font

  // Rebuild the embed URL from the (deduped) heading + body + accent families.
  const families = Array.from(
    new Set([typography.headingFont, typography.bodyFont, typography.accentFont].filter(Boolean))
  ) as string[]
  typography.googleFontsUrl = gfUrl(families)

  const next: DesignJson = { ...design, typography }
  const nextText = serialize(next)
  return { ok: true, next: nextText, design: next, changed: nextText !== designJsonText }
}

// The block ids that carry a data-block attribute and can be targeted from
// design-overrides.css. Kept in sync with the template's block catalog.
export const OVERRIDE_BLOCKS = [
  'hero',
  'page-header',
  'hero-split',
  'intro-text',
  'content-split',
  'content-prose',
  'checklist-section',
  'process-steps',
  'feature-grid',
  'service-cards',
  'content-cards',
  'team-grid',
  'industry-cards',
  'testimonials',
  'stats-bar',
  'logo-bar',
  'cta-banner',
  'pricing',
  'faq-accordion',
  'form',
  'content-table',
  'client-center',
] as const

// A design-overrides.css guardrail: refuse @import (external CSS / data
// exfiltration) and url() with a remote scheme. Per-client polish should be
// self-contained rules, not network fetches.
const FORBIDDEN_CSS = /@import\b|url\(\s*['"]?\s*(https?:|\/\/)/i

export type OverrideResult = { ok: true; next: string } | { ok: false; reason: string }

// Append (or replace) a scoped block-override rule in design-overrides.css. We
// key each managed rule by a marker comment so re-editing the same block
// replaces its prior rule instead of stacking duplicates.
export function upsertBlockOverride(currentCss: string, block: string, css: string): OverrideResult {
  if (!OVERRIDE_BLOCKS.includes(block as (typeof OVERRIDE_BLOCKS)[number])) {
    return { ok: false, reason: `Unknown block "${block}". Valid blocks: ${OVERRIDE_BLOCKS.join(', ')}.` }
  }
  const body = css.trim()
  if (!body) return { ok: false, reason: 'The CSS rule body is empty.' }
  if (FORBIDDEN_CSS.test(body)) {
    return { ok: false, reason: 'design-overrides.css may not use @import or remote url() — write self-contained rules.' }
  }
  if (body.includes('</') || body.includes('<script')) {
    return { ok: false, reason: 'The CSS contains disallowed markup.' }
  }

  const startMarker = `/* theme-editor:${block} */`
  const endMarker = `/* /theme-editor:${block} */`
  const block_ = `${startMarker}\n${body}\n${endMarker}`

  const startIdx = currentCss.indexOf(startMarker)
  if (startIdx !== -1) {
    const endIdx = currentCss.indexOf(endMarker, startIdx)
    if (endIdx !== -1) {
      const before = currentCss.slice(0, startIdx)
      const after = currentCss.slice(endIdx + endMarker.length)
      return { ok: true, next: `${before}${block_}${after}` }
    }
  }
  const sep = currentCss.endsWith('\n') || currentCss === '' ? '' : '\n'
  return { ok: true, next: `${currentCss}${sep}\n${block_}\n` }
}
