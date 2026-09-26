// Pure helpers for the Theme Studio pickers (PATCH /api/edit/[id]/theme). They
// patch a client site's content/brand.json (palette) and content/design.json
// (fonts, treatment flags) as text — parse, merge the requested fields,
// re-serialize in the repo's 2-space + trailing-newline JSON style. theme.css is
// regenerated separately by the route via generateThemeCss(); these helpers only
// own the JSON source-of-truth files. design-overrides.css is owned by the
// Design Studio's managed region (lib/design/bundle-files.ts), not by this file.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { CURATED_FONTS, gfUrl } from '@/lib/content/type-pairing-catalog'

export const HEX_RE = /^#[0-9a-fA-F]{6}$/
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
// (Used by the Design Studio bundle schema.)
export const LENGTH_RE = /^(0|[0-9]+(\.[0-9]+)?(px|rem|em|%|vw|vh))$/

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

// ---------------------------------------------------------------------------
// Typography (fonts). Every
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

// ---------------------------------------------------------------------------
// Opt-in treatment flags (Revaltus-corporate look). Each maps to a design.json
// field the template reads to set <html data-headline>/<html data-eyebrow> and
// to gate the ink section rhythm. A flag at its DEFAULT is deleted so an
// untouched design.json stays minimal and matches design-json-builder's
// omit-at-default behaviour.
// ---------------------------------------------------------------------------
export type DesignFlagsPatch = {
  headlineStyle?: DesignJson['headlineStyle']
  eyebrowStyle?: DesignJson['eyebrowStyle']
  darkSections?: DesignJson['darkSections']
}

const HEADLINE_STYLES = ['sans', 'serif'] as const
const EYEBROW_STYLES = ['standard', 'mono'] as const

export function patchDesignFlags(designJsonText: string, patch: DesignFlagsPatch): DesignPatchResult {
  let design: DesignJson
  try {
    design = JSON.parse(designJsonText) as DesignJson
  } catch {
    return { ok: false, reason: 'content/design.json is not valid JSON.' }
  }

  const provided = Object.entries(patch).filter(([, v]) => v !== undefined)
  if (provided.length === 0) return { ok: false, reason: 'No treatment changes were provided.' }

  const next: DesignJson = { ...design }

  if (patch.headlineStyle !== undefined) {
    if (!HEADLINE_STYLES.includes(patch.headlineStyle)) return { ok: false, reason: 'headlineStyle must be sans or serif.' }
    if (patch.headlineStyle === 'sans') delete next.headlineStyle
    else next.headlineStyle = patch.headlineStyle
  }
  if (patch.eyebrowStyle !== undefined) {
    if (!EYEBROW_STYLES.includes(patch.eyebrowStyle)) return { ok: false, reason: 'eyebrowStyle must be standard or mono.' }
    if (patch.eyebrowStyle === 'standard') delete next.eyebrowStyle
    else next.eyebrowStyle = patch.eyebrowStyle
  }
  if (patch.darkSections !== undefined) {
    if (typeof patch.darkSections !== 'boolean') return { ok: false, reason: 'darkSections must be true or false.' }
    if (!patch.darkSections) delete next.darkSections
    else next.darkSections = true
  }

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
