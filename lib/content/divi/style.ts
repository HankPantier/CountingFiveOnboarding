// ---------------------------------------------------------------------------
// Client styling for the Divi export bridge (see ./README.md).
//
// One model of the client's design system — brand.json palette + design.json
// tokens, derived with the template's own contrast rules (theme-css-generator)
// — consumed three ways:
//   - page/header/footer shortcode: templates carry colour TOKENS
//     ({{c5:primary}}, {{c5:text}}, {{c5:primary/0.15}}, {{pad:60}}) that
//     applyDiviStyle() resolves to hex and links to Divi Global Colors;
//   - the Customizer import (./customizer.ts): fonts, H1–H6, buttons, colours;
//   - the "Revaltus brand" Additional CSS block (brandCss): the template's
//     fluid type scale, radii, shadows and treatments.
// ---------------------------------------------------------------------------

import chroma from 'chroma-js'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import type { Density, Roundness } from '@/types/design-tokens'
import { buildDesignJson } from '@/lib/content/design-json-builder'
import { TYPE_PAIRINGS } from '@/lib/content/type-pairing-catalog'
import {
  deriveLightActionTextTokens,
  ensureContrast,
  pickForeground,
  renderedHex,
  setLightness,
} from '@/lib/content/theme-css-generator'

export const PALETTE_ROLES = ['primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite'] as const
export type PaletteRole = (typeof PALETTE_ROLES)[number]

// Derived roles used by the templates (resolved to hex; linked to a Global
// Color only when the derived value IS that palette colour).
export const DERIVED_ROLES = [
  'text', // body copy
  'heading', // headings on light surfaces
  'primarySurface', // the primary background, AA-corrected against onPrimary
  'onPrimary', // text on the primary surface
  'onAction', // text on action-coloured buttons
  'actionText', // small action-coloured text on light surfaces (links, eyebrows)
  'actionOnPrimary', // small action text on primary/ink surfaces
  'surfaceMuted', // muted light band (card grids, FAQ)
  'border',
  'ink', // deep dark-section surface
  'onInk',
  'band', // the theme: ink band surface — primary, or ink when darkSections is on
  'onBand',
] as const
export type DerivedRole = (typeof DERIVED_ROLES)[number]
export type ColorRole = PaletteRole | DerivedRole

const GCID_SLUG: Record<PaletteRole, string> = {
  primary: 'primary',
  secondary: 'secondary',
  complementary: 'complementary',
  action: 'action',
  nearBlack: 'near-black',
  nearWhite: 'near-white',
}
export const GLOBAL_COLOR_LABEL: Record<PaletteRole, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  complementary: 'Complementary',
  action: 'Action',
  nearBlack: 'Near black',
  nearWhite: 'Near white',
}
export function gcidFor(role: PaletteRole): string {
  return `gcid-c5-${GCID_SLUG[role]}`
}

// The template's fluid type scale (counting-five-client-template globals.css).
// px = the clamp() bounds at 16px root, for Divi's px-only settings.
export const TYPE_SCALE = {
  display: { css: 'clamp(2.6rem, 1.4rem + 4.2vw, 4.25rem)', lineHeight: '1.02', tracking: '-0.025em' },
  h1: { css: 'clamp(2rem, 1.3rem + 2.4vw, 3rem)', lineHeight: '1.05', tracking: '-0.015em', px: { phone: 32, tablet: 40, desktop: 48 } },
  h2: { css: 'clamp(1.6rem, 1.15rem + 1.5vw, 2.25rem)', lineHeight: '1.12', tracking: '-0.015em', px: { phone: 26, tablet: 30, desktop: 36 } },
  h3: { css: '1.375rem', lineHeight: '1.25', tracking: 'normal', px: { phone: 22, tablet: 22, desktop: 22 } },
  h4: { css: '1.125rem', lineHeight: '1.3', tracking: 'normal', px: { phone: 18, tablet: 18, desktop: 18 } },
  h5: { css: '1rem', lineHeight: '1.4', tracking: 'normal', px: { phone: 16, tablet: 16, desktop: 16 } },
  h6: { css: '0.875rem', lineHeight: '1.4', tracking: 'normal', px: { phone: 14, tablet: 14, desktop: 14 } },
  body: { css: '1rem', lineHeight: '1.7', px: 16 },
} as const

const DENSITY_FACTOR: Record<Density, number> = { tight: 0.8, balanced: 1, airy: 1.25 }
const HEX = /^#[0-9a-f]{6}$/i

export type DiviStyle = {
  palette: Record<PaletteRole, string>
  derived: Record<DerivedRole, string>
  fonts: { heading: string; body: string; accent: string; googleFontsUrl: string | null }
  roundness: Roundness
  density: Density
  radius: { button: string; card: string; image: string }
  paddingFactor: number
  shadowRgb: string // "r, g, b" of the primary, for the navy-tinted shadow scale
  treatments: { serifHeadlines: boolean; darkSections: boolean; monoEyebrows: boolean }
}

const FALLBACK_PALETTE: Record<PaletteRole, string> = {
  primary: '#231F20',
  secondary: '#098195',
  complementary: '#098195',
  action: '#098195',
  nearBlack: '#231F20',
  nearWhite: '#FAFAFA',
}

// Font names go into CSS strings and Divi settings — keep them to plain names.
function cleanFont(name: unknown, fallback: string): string {
  const s = typeof name === 'string' ? name.replace(/["';{}<>\\]/g, '').trim() : ''
  return s || fallback
}

function fontsUrl(url: unknown): string | null {
  return typeof url === 'string' && /^https:\/\/fonts\.googleapis\.com\/[^\s"'()<>]+$/.test(url) ? url : null
}

// The design.json a site without one would have: the first catalog pairing at
// the template defaults.
export function defaultDesignJson(): DesignJson {
  const p = TYPE_PAIRINGS[0]
  return buildDesignJson({
    typePairing: { id: p.id, headingFont: p.headingFont, bodyFont: p.bodyFont, label: p.label, accentFont: p.accentFont },
    roundness: 'soft',
    density: 'balanced',
    visualFeel: 'modern',
  })
}

// Parse a repo design.json defensively — older sites miss newer fields, and a
// bad file must not break the export.
export function parseDesignJsonText(text: string | null): DesignJson {
  const fallback = defaultDesignJson()
  if (!text) return fallback
  try {
    const raw = JSON.parse(text) as Partial<DesignJson> | null
    if (!raw || typeof raw !== 'object') return fallback
    return {
      ...fallback,
      ...raw,
      typography: { ...fallback.typography, ...(raw.typography ?? {}) },
      radius: { ...fallback.radius, ...(raw.radius ?? {}) },
      spacing: { ...fallback.spacing, ...(raw.spacing ?? {}) },
    }
  } catch {
    return fallback
  }
}

export function buildDiviStyle(brand: Pick<BrandJson, 'palette'>, design: DesignJson): DiviStyle {
  const palette = {} as Record<PaletteRole, string>
  for (const role of PALETTE_ROLES) {
    const v = brand.palette?.[role]
    palette[role] = typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : FALLBACK_PALETTE[role]
  }

  // Same derivations as the template's theme.css (generateThemeCss).
  const onPrimary = pickForeground(palette.primary, palette.nearWhite, palette.nearBlack)
  const primaryBg = ensureContrast(palette.primary, onPrimary)
  const text = ensureContrast(palette.nearBlack, palette.nearWhite)
  const surfaceMuted = setLightness(palette.nearWhite, 95)
  const border = setLightness(palette.nearWhite, 90)
  const ink = setLightness(chroma.mix(palette.nearBlack, palette.primary, 0.4, 'lab').hex(), 12)
  const onInk = pickForeground(ink, palette.nearWhite, palette.nearBlack)
  const action = deriveLightActionTextTokens(palette.action, {
    background: renderedHex(palette.nearWhite),
    muted: renderedHex(surfaceMuted),
    card: renderedHex(palette.nearWhite),
    primary: renderedHex(primaryBg),
    ink,
  })
  const up = (h: string) => h.toUpperCase()

  const roundness: Roundness = (['sharp', 'soft', 'pill'] as const).includes(design.roundness) ? design.roundness : 'soft'
  const density: Density = (['tight', 'balanced', 'airy'] as const).includes(design.density) ? design.density : 'balanced'
  const [r, g, b] = chroma(palette.primary).rgb()

  return {
    palette,
    derived: {
      text: up(text),
      heading: up(text),
      primarySurface: up(primaryBg),
      onPrimary: up(onPrimary),
      onAction: up(pickForeground(palette.action, palette.nearWhite, palette.nearBlack)),
      actionText: up(action.actionText),
      actionOnPrimary: up(action.actionOnPrimary),
      surfaceMuted: up(surfaceMuted),
      border: up(border),
      ink: up(ink),
      onInk: up(onInk),
      band: design.darkSections === true ? up(ink) : up(primaryBg),
      onBand: design.darkSections === true ? up(onInk) : up(onPrimary),
    },
    fonts: {
      heading: cleanFont(design.typography?.headingFont, 'Inter'),
      body: cleanFont(design.typography?.bodyFont, 'Inter'),
      accent: cleanFont(design.typography?.accentFont, 'Fraunces'),
      googleFontsUrl: fontsUrl(design.typography?.googleFontsUrl),
    },
    roundness,
    density,
    // Buttons follow the roundness token (the template's --radius-pill); cards and
    // images use the template's lg radius, squared off for 'sharp'.
    radius: {
      button: roundness === 'pill' ? '40px' : roundness === 'soft' ? '8px' : '4px',
      card: roundness === 'sharp' ? '4px' : '16px',
      image: roundness === 'sharp' ? '4px' : '12px',
    },
    paddingFactor: DENSITY_FACTOR[density],
    shadowRgb: `${r}, ${g}, ${b}`,
    treatments: {
      serifHeadlines: design.headlineStyle === 'serif',
      darkSections: design.darkSections === true,
      monoEyebrows: design.eyebrowStyle === 'mono',
    },
  }
}

// ---------------------------------------------------------------------------
// Template tokens
// ---------------------------------------------------------------------------

/** A colour token: `{{c5:role}}`, or `{{c5:role/0.15}}` for an rgba tint. */
export function c5(role: ColorRole, alpha?: number): string {
  return alpha === undefined ? `{{c5:${role}}}` : `{{c5:${role}/${alpha}}}`
}
/** A density-scaled padding token (base px at 'balanced'). */
export function pad(px: number): string {
  return `{{pad:${px}}}`
}
export const HEADING_FONT = (weight: 600 | 700 | 800 = 700) => `--et_global_heading_font|${weight}|||||||`
export const BODY_FONT = '--et_global_body_font||||||||'

const COLOR_TOKEN = /\{\{c5:([a-zA-Z]+)(?:\/([0-9.]+))?\}\}/g
const PAD_TOKEN = /\{\{pad:(\d+)\}\}/g
const RADIUS_TOKEN = /\{\{radius:(button|card|image)\}\}/g
const GCI_EMPTY = 'global_colors_info="{}"'

export function radius(kind: keyof DiviStyle['radius']): string {
  return `{{radius:${kind}}}`
}

function isPaletteRole(role: string): role is PaletteRole {
  return (PALETTE_ROLES as readonly string[]).includes(role)
}
function isColorRole(role: string): role is ColorRole {
  return isPaletteRole(role) || (DERIVED_ROLES as readonly string[]).includes(role)
}

function resolveColor(style: DiviStyle, role: string, alpha: string | undefined): { value: string; gcid: string | null } {
  if (!isColorRole(role)) throw new Error(`Unknown Divi colour token role: ${role}`)
  const hex = isPaletteRole(role) ? style.palette[role] : style.derived[role]
  if (alpha !== undefined) {
    const [r, g, b] = chroma(hex).rgb()
    return { value: `rgba(${r},${g},${b},${alpha})`, gcid: null }
  }
  // Link to the Global Color the value is (a derived role usually equals one).
  const linked = isPaletteRole(role)
    ? role
    : PALETTE_ROLES.find((p) => style.palette[p].toUpperCase() === hex.toUpperCase()) ?? null
  return { value: hex, gcid: linked ? gcidFor(linked) : null }
}

function resolvePlain(text: string, style: DiviStyle): string {
  return text
    .replace(COLOR_TOKEN, (_m, role: string, alpha: string | undefined) => resolveColor(style, role, alpha).value)
    .replace(PAD_TOKEN, (_m, px: string) => `${Math.round(Number(px) * style.paddingFactor)}px`)
    .replace(RADIUS_TOKEN, (_m, kind: keyof DiviStyle['radius']) => style.radius[kind])
}

// Divi stores a module's Global Color links as URL-ish JSON in an attribute:
// {"gcid-x":["attr_a","attr_b"]} with " → %22, [ → %91, ] → %93.
export function encodeGlobalColorsInfo(links: Map<string, string[]>): string {
  if (links.size === 0) return '{}'
  const body = [...links]
    .map(([gcid, attrs]) => `%22${gcid}%22:%91${attrs.map((a) => `%22${a}%22`).join(',')}%93`)
    .join(',')
  return `{${body}}`
}

// Resolve every token in emitted shortcode. Each module tag in our templates
// ends in global_colors_info="{}"; the attributes of that tag that carry a
// palette colour are recorded there so Divi links them to its Global Colors
// (the hex stays in the attribute, so the page renders even before the
// Customizer import). Tokens outside tags (inline HTML styles) just resolve.
export function applyDiviStyle(content: string, style: DiviStyle): string {
  const chunks = content.split(GCI_EMPTY)
  return chunks
    .map((chunk, i) => {
      if (i === chunks.length - 1) return resolvePlain(chunk, style)
      const start = chunk.lastIndexOf('[et_pb_')
      if (start === -1) return resolvePlain(chunk, style) + GCI_EMPTY
      const head = resolvePlain(chunk.slice(0, start), style)
      const links = new Map<string, string[]>()
      const tag = chunk.slice(start).replace(/([a-z0-9_]+)="([^"]*)"/g, (full, name: string, value: string) => {
        if (!value.includes('{{')) return full
        const resolved = resolvePlain(
          value.replace(COLOR_TOKEN, (_m, role: string, alpha: string | undefined) => {
            const c = resolveColor(style, role, alpha)
            if (c.gcid) {
              const attrs = links.get(c.gcid) ?? []
              if (!attrs.includes(name)) attrs.push(name)
              links.set(c.gcid, attrs)
            }
            return c.value
          }),
          style
        )
        return `${name}="${resolved}"`
      })
      return `${head}${tag}global_colors_info="${encodeGlobalColorsInfo(links)}"`
    })
    .join('')
}

// Divi Library / Customizer Global Colors for the client palette.
export function globalColorEntries(style: DiviStyle): Array<[string, { color: string; active: 'yes' }]> {
  return PALETTE_ROLES.map((role) => [gcidFor(role), { color: style.palette[role], active: 'yes' }])
}

// ---------------------------------------------------------------------------
// Additional CSS — the "Revaltus brand" block
// ---------------------------------------------------------------------------

export const BRAND_CSS_START = '/* ==== Revaltus brand: START (generated by the Revaltus export; re-export to change, edits here are overwritten) ==== */'
export const BRAND_CSS_END = '/* ==== Revaltus brand: END ==== */'

export function brandCss(style: DiviStyle): string {
  const p = style.palette
  const d = style.derived
  const f = style.fonts
  const sh = style.shadowRgb
  const sans = 'system-ui, -apple-system, "Segoe UI", sans-serif'
  const headingFamily = style.treatments.serifHeadlines ? 'var(--c5-font-accent)' : 'var(--c5-font-heading)'
  const heading = (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', weight: number) => {
    const t = TYPE_SCALE[tag]
    return `body ${tag} { font-size: ${t.css}; line-height: ${t.lineHeight}; letter-spacing: ${t.tracking}; font-weight: ${weight}; }`
  }
  return [
    BRAND_CSS_START,
    ':root {',
    `  --c5-primary: ${p.primary}; --c5-secondary: ${p.secondary}; --c5-complementary: ${p.complementary};`,
    `  --c5-action: ${p.action}; --c5-near-black: ${p.nearBlack}; --c5-near-white: ${p.nearWhite};`,
    `  --c5-text: ${d.text}; --c5-heading: ${d.heading}; --c5-link: ${d.actionText}; --c5-on-action: ${d.onAction};`,
    `  --c5-font-heading: "${f.heading}", ${sans};`,
    `  --c5-font-body: "${f.body}", ${sans};`,
    `  --c5-font-accent: "${f.accent}", Georgia, "Times New Roman", serif;`,
    `  --c5-radius-button: ${style.radius.button}; --c5-radius-card: ${style.radius.card};`,
    `  --c5-shadow-card: 0 2px 8px rgba(${sh}, 0.08); --c5-shadow-card-hover: 0 8px 20px -4px rgba(${sh}, 0.16);`,
    '}',
    'body, body p, body li, body input, body textarea, body select { font-family: var(--c5-font-body); }',
    `body { color: var(--c5-text); font-size: ${TYPE_SCALE.body.css}; line-height: ${TYPE_SCALE.body.lineHeight}; }`,
    'body h1, body h2, body h3, body h4, body h5, body h6 { font-family: var(--c5-font-heading); text-transform: none; }',
    heading('h1', 700),
    heading('h2', 700),
    heading('h3', 600),
    heading('h4', 600),
    heading('h5', 600),
    heading('h6', 600),
    `body h1, body h2 { font-family: ${headingFamily}; text-wrap: balance; }`,
    `body .c5-display { font-size: ${TYPE_SCALE.display.css}; line-height: ${TYPE_SCALE.display.lineHeight}; letter-spacing: ${TYPE_SCALE.display.tracking}; }`,
    'body a { color: var(--c5-link); }',
    `body .et_pb_bg_layout_dark a { color: ${d.actionOnPrimary}; }`,
    'body .et_pb_button, body .et_pb_pricing_table_button { font-family: var(--c5-font-heading); border-radius: var(--c5-radius-button); }',
    'body .gform_wrapper .gform_footer input[type="submit"], body .gform_wrapper .gform_page_footer input[type="submit"] {',
    '  background: var(--c5-action) !important; color: var(--c5-on-action) !important;',
    '  border-radius: var(--c5-radius-button) !important; font-family: var(--c5-font-heading); text-transform: none; letter-spacing: normal;',
    '}',
    'body .gform_wrapper .gfield input, body .gform_wrapper .gfield textarea, body .gform_wrapper .gfield select { border-radius: var(--c5-radius-card); }',
    'body .c5-card { box-shadow: var(--c5-shadow-card); transition: box-shadow 200ms ease; }',
    'body .c5-card:hover { box-shadow: var(--c5-shadow-card-hover); }',
    BRAND_CSS_END,
  ].join('\n')
}

// Font @imports for Additional CSS: the client's pairing, plus the accent serif
// when serif headlines use it (the template loads that font separately).
export function googleFontsImport(style: DiviStyle): string {
  const urls = style.fonts.googleFontsUrl ? [style.fonts.googleFontsUrl] : []
  if (style.treatments.serifHeadlines && !urls.some((u) => u.includes(`family=${style.fonts.accent.replace(/ /g, '+')}`))) {
    urls.push(`https://fonts.googleapis.com/css2?family=${style.fonts.accent.replace(/ /g, '+')}:wght@500;600;700&display=swap`)
  }
  return urls.map((u) => `@import url("${u}");`).join('\n')
}
