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
import { DEFAULT_AXIS_VALUE, STYLE_AXES, STYLE_AXIS_NAMES, type StyleAxes } from '@/lib/design/style-axes'
import { LOGO_SIZES, type LogoSize } from '@/lib/design/logo-size'
import {
  DEFAULT_LAYOUT_PRESET,
  LAYOUT_PRESETS,
  LAYOUT_PRESET_NAMES,
  type LayoutPresets,
} from '@/lib/design/layout-presets'

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

export type LogoPatch = {
  /** Bare content-assets filename for logo.primary. */
  primary?: string
  /** Bare filename for logo.footer, or null to remove it (footer falls back to primary). */
  footer?: string | null
  /** logo.tone: 'light' sets it, null removes it. Omit to leave as-is. */
  tone?: 'light' | null
}

const LOGO_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp|svg)$/

// Point brand.json's logo at newly uploaded files (Theme Studio logo upload).
// Values are bare filenames the template resolves under /content-assets/.
export function patchBrandLogo(brandJsonText: string, patch: LogoPatch): BrandPatchResult {
  let brand: BrandJson
  try {
    brand = JSON.parse(brandJsonText) as BrandJson
  } catch {
    return { ok: false, reason: 'content/brand.json is not valid JSON.' }
  }
  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) {
    return { ok: false, reason: 'content/brand.json is not an object.' }
  }
  for (const v of [patch.primary, patch.footer]) {
    if (typeof v === 'string' && !LOGO_FILE_RE.test(v)) return { ok: false, reason: `Invalid logo file name "${v}".` }
  }
  const current = brand.logo && typeof brand.logo === 'object' && !Array.isArray(brand.logo) ? brand.logo : { primary: '', alt: '' }
  const logo = { ...current }
  if (patch.primary !== undefined) logo.primary = patch.primary
  if (patch.footer === null) delete logo.footer
  else if (patch.footer !== undefined) logo.footer = patch.footer
  if (patch.tone === null) delete logo.tone
  else if (patch.tone !== undefined) logo.tone = patch.tone
  if (!logo.alt && brand.firm?.name) logo.alt = `${brand.firm.name} logo`
  const next: BrandJson = { ...brand, logo }
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
  /** design.json `logo.size` (template 2026.09.8): 'standard' deletes it (and an
   * emptied `logo` object), so an untouched design.json stays byte-identical. */
  logoSize?: LogoSize
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
  if (patch.logoSize !== undefined) {
    if (!LOGO_SIZES.includes(patch.logoSize)) return { ok: false, reason: 'logoSize must be standard or large.' }
    // A hand-edited design.json can carry a non-object `logo` (a string, an
    // array, null): replace it rather than spread it into a broken object.
    const current: unknown = design.logo
    const logo: NonNullable<DesignJson['logo']> =
      current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as NonNullable<DesignJson['logo']>) } : {}
    if (patch.logoSize === 'standard') delete logo.size
    else logo.size = patch.logoSize
    if (Object.keys(logo).length) next.logo = logo
    else delete next.logo
  }

  const nextText = serialize(next)
  return { ok: true, next: nextText, design: next, changed: nextText !== designJsonText }
}

// ---------------------------------------------------------------------------
// Style axes (template T2). Merge-patch: provided axes only; 'default' deletes
// the axis; an empty result deletes `style` — so an untouched design.json
// stays byte-identical (omit-at-default, like the treatment flags).
// ---------------------------------------------------------------------------
export function patchDesignStyle(designJsonText: string, patch: StyleAxes): DesignPatchResult {
  let design: DesignJson
  try {
    design = JSON.parse(designJsonText) as DesignJson
  } catch {
    return { ok: false, reason: 'content/design.json is not valid JSON.' }
  }
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [string, string][]
  if (entries.length === 0) return { ok: false, reason: 'No style changes were provided.' }

  const style: Record<string, string> = { ...(design.style ?? {}) }
  for (const [axis, value] of entries) {
    if (!(STYLE_AXIS_NAMES as string[]).includes(axis)) return { ok: false, reason: `Unknown style axis: ${axis}.` }
    const values = STYLE_AXES[axis as keyof typeof STYLE_AXES].values as readonly string[]
    if (!values.includes(value)) return { ok: false, reason: `${axis} must be one of ${values.join(', ')}.` }
    if (value === DEFAULT_AXIS_VALUE) delete style[axis]
    else style[axis] = value
  }
  const next: DesignJson = { ...design }
  if (Object.keys(style).length) next.style = style
  else delete next.style
  const nextText = serialize(next)
  return { ok: true, next: nextText, design: next, changed: nextText !== designJsonText }
}

// ---------------------------------------------------------------------------
// Layout presets (template 2026.09.9, `layout-presets` capability). A SIBLING
// design.json key, not a style axis. Merge-patch: provided presets only;
// 'default' deletes the preset; an empty result deletes `layout` — so an
// untouched design.json stays byte-identical. A hand-edited non-object
// `layout` is replaced rather than spread.
// ---------------------------------------------------------------------------
export function patchDesignLayout(designJsonText: string, patch: LayoutPresets): DesignPatchResult {
  let design: DesignJson
  try {
    design = JSON.parse(designJsonText) as DesignJson
  } catch {
    return { ok: false, reason: 'content/design.json is not valid JSON.' }
  }
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [string, string][]
  if (entries.length === 0) return { ok: false, reason: 'No layout changes were provided.' }

  const current: unknown = design.layout
  const layout: Record<string, string> =
    current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, string>) } : {}
  for (const [name, value] of entries) {
    if (!(LAYOUT_PRESET_NAMES as string[]).includes(name)) return { ok: false, reason: `Unknown layout preset: ${name}.` }
    const values = LAYOUT_PRESETS[name as keyof typeof LAYOUT_PRESETS].values as readonly string[]
    if (!values.includes(value)) return { ok: false, reason: `${name} must be one of ${values.join(', ')}.` }
    if (value === DEFAULT_LAYOUT_PRESET) delete layout[name]
    else layout[name] = value
  }
  const next: DesignJson = { ...design }
  if (Object.keys(layout).length) next.layout = layout
  else delete next.layout
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
  // Appended (never reordered — composeRegion writes fragments in this order):
  // the calculator's estimate figure is --color-action on a --color-primary
  // panel, and a concept must be able to restyle it (live run a81093ea).
  'pricing-calculator',
  // Appended 2026-09-26: the remaining blocks /design-specimen renders that
  // carry a data-block (template block registry) — a render-check failure on
  // them was only fixable through the palette.
  'pricing-plans',
  'booking',
  'contact-info',
  'map',
  'resource-list',
  // Appended 2026-09-28: blocks every generated page renders that were never
  // targetable — the "Quick answer" callout (answer-callout), the related
  // links footer and the trust-signals list. The design chat could not style
  // them and guessed a neighbouring block instead.
  'answer-callout',
  'related-links',
  'trust-signals',
  // Appended 2026-09-28 (template 2026.09.11 adds the data-block): the blog
  // index, a post's image / body / related reading, and the 404 page.
  'resource-browser',
  'post-image',
  'post-body',
  'related-posts',
  'not-found',
] as const
