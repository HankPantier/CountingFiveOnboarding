import chroma from 'chroma-js'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

// Regenerate a client site's src/styles/theme.css from its brand.json palette +
// design.json tokens — a PURE port of the template's scripts/generate-theme.ts
// (counting-five-client-template). The onboarding app owns this because the
// template does NOT rerun generate-theme.ts on deploy: theme.css is a committed
// static file, so an admin palette/token change must ship a regenerated
// theme.css alongside the JSON. This MUST stay byte-for-byte identical to the
// template script's output — the golden-fixture test (theme-css-generator.test.ts)
// guards against drift. If the template script changes, update both together.

// Convert a hex color to an HSL space-separated token (e.g. "220 75% 50%")
// without the hsl() wrapper. Achromatic (grayscale) colors report NaN hue.
function toHslTokens(hex: string, fallback = '220 10% 50%'): string {
  try {
    const [h, s, l] = chroma(hex).hsl()
    if (isNaN(h)) {
      return `0 0% ${(l * 100).toFixed(0)}%`
    }
    return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
  } catch {
    return fallback
  }
}

// Pick foreground (near-white or near-black) with WCAG contrast >= 4.5 on bg.
function pickForeground(bgHex: string, nearWhiteHex: string, nearBlackHex: string): string {
  try {
    const cw = chroma.contrast(bgHex, nearWhiteHex)
    const cb = chroma.contrast(bgHex, nearBlackHex)
    if (cw >= 4.5) return nearWhiteHex
    if (cb >= 4.5) return nearBlackHex
    return cw >= cb ? nearWhiteHex : nearBlackHex
  } catch {
    return nearWhiteHex
  }
}

// Override HSL lightness (0–100), preserving hue + saturation. Uses
// .set('hsl.l', ...) to avoid the bare-array constructor which defaults to RGB.
function setLightness(hex: string, targetL: number): string {
  try {
    return chroma(hex).set('hsl.l', targetL / 100).hex()
  } catch {
    return hex
  }
}

// Nudge a surface color's lightness until it clears WCAG `minRatio` against the
// foreground, preserving hue + saturation. No-op when the pair already passes.
function ensureContrast(bgHex: string, fgHex: string, minRatio = 4.5): string {
  try {
    if (chroma.contrast(bgHex, fgHex) >= minRatio) return bgHex
    const darkenBg = chroma(fgHex).luminance() > chroma(bgHex).luminance()
    const startL = Math.round(chroma(bgHex).get('hsl.l') * 100)
    for (let l = startL; l >= 0 && l <= 100; darkenBg ? l-- : l++) {
      const candidate = setLightness(bgHex, l)
      if (chroma.contrast(candidate, fgHex) >= minRatio) return candidate
    }
    return setLightness(bgHex, darkenBg ? 0 : 100)
  } catch {
    return bgHex
  }
}

// ---- Small-text action colour (auto-corrected) ------------------------------
// Port of the template's src/lib/theme/action-text-contrast.ts — keep in sync
// (theme.css.golden + the shared __fixtures__/action-text-table.json guard it).
// One action colour can't clear 4.5:1 on both the page background and a dark
// primary (contrast(a,bg) × contrast(a,p) = contrast(bg,p)), so theme.css ships
// a text variant per surface family, each corrected against the colours that
// surface actually RENDERS (surfaces are emitted as hsl() rounded to whole
// percents, so the rendered colour — not the palette hex — is what counts):
//   --color-action-text / -text-canvas  canvas: background, muted (flat cards), card
//   --color-action-text-tint            10% / 15% action-tint badges, over both
//                                       surfaces they sit on: the page background
//                                       (post header, pricing toggle) and the card
//   --color-action-on-primary / -on-ink bg-primary / Section bg="ink"
//   .dark: -text / -text-canvas / -text-tint on the dark neutrals (-text-tint,
//   like light mode, clears the tint over the background AND the card).
// Moves OKLCH lightness only in 0.001 steps away from the surfaces (the side it
// already sits on first); hue held, chroma reduced only to stay inside sRGB
// (binary search, never per-channel clipping). The first hex that clears
// `minRatio` on EVERY surface wins; a colour that already passes is returned
// EXACTLY (same string/case). Never throws.
const ACTION_TEXT_L_STEP = 0.001
const ACTION_TEXT_CHROMA_STEPS = 24

// "h s% l%" (optionally wrapped in hsl()) → the 8-bit hex a browser paints.
export function hslTokensToHex(tokens: string): string {
  const m = tokens.match(/(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%/)
  if (!m) throw new Error(`not an hsl token: ${tokens}`)
  return chroma.hsl(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100).hex()
}

// The colour a surface emitted as hsl(toHslTokens(hex)) actually renders.
export function renderedHex(hex: string): string {
  return hslTokensToHex(toHslTokens(hex))
}

function inGamutHex(l: number, c: number, h: number): string {
  const direct = chroma.oklch(l, c, h)
  if (!direct.clipped()) return direct.hex()
  let lo = 0
  let hi = c
  for (let i = 0; i < ACTION_TEXT_CHROMA_STEPS; i++) {
    const mid = (lo + hi) / 2
    if (chroma.oklch(l, mid, h).clipped()) hi = mid
    else lo = mid
  }
  return chroma.oklch(l, lo, h).hex()
}

function minContrast(text: string, surfaces: string[]): number {
  return Math.min(...surfaces.map((s) => chroma.contrast(text, s)))
}

export function ensureTextContrast(textHex: string, surface: string | string[], minRatio = 4.5): string {
  try {
    const surfaces = Array.isArray(surface) ? surface : [surface]
    if (minContrast(textHex, surfaces) >= minRatio) return textHex
    const [l0, c0, h0] = chroma(textHex).oklch()
    const achromatic = isNaN(h0)
    const h = achromatic ? 0 : h0
    const c = achromatic ? 0 : c0
    const lighter = chroma(textHex).luminance() > chroma(surfaces[0]).luminance()
    const directions = lighter ? [1, -1] : [-1, 1]
    for (const dir of directions) {
      for (let i = 1; ; i++) {
        const l = l0 + dir * i * ACTION_TEXT_L_STEP
        if (l < 0 || l > 1) break
        const candidate = inGamutHex(l, c, h)
        if (minContrast(candidate, surfaces) >= minRatio) return candidate
      }
    }
    const black = inGamutHex(0, 0, h)
    const white = inGamutHex(1, 0, h)
    return minContrast(black, surfaces) >= minContrast(white, surfaces) ? black : white
  } catch {
    return textHex
  }
}

// Action at `alpha` composited over `under` (how bg-[action]/10 paints).
function tintOver(under: string, action: string, alpha: number): string {
  return chroma.mix(under, action, alpha, 'rgb').hex()
}

const TINT_ALPHAS = [0.1, 0.15]

// Every tint the badges paint: each alpha over each canvas surface they can sit on.
function tintSurfaces(action: string, unders: string[]): string[] {
  return unders.flatMap((u) => TINT_ALPHAS.map((a) => tintOver(u, action, a)))
}

// RENDERED surfaces (hex of what the browser paints).
export type LightSurfaces = { background: string; muted: string; card: string; primary: string; ink: string }
export type DarkSurfaces = { background: string; muted: string; card: string }
export type LightActionTextTokens = { actionText: string; actionTextTint: string; actionOnPrimary: string; actionOnInk: string }
export type DarkActionTextTokens = { actionText: string; actionTextTint: string }

export function deriveLightActionTextTokens(action: string, s: LightSurfaces): LightActionTextTokens {
  return {
    actionText: ensureTextContrast(action, [s.background, s.muted, s.card]),
    actionTextTint: ensureTextContrast(action, tintSurfaces(action, [s.background, s.card])),
    actionOnPrimary: ensureTextContrast(action, s.primary),
    actionOnInk: ensureTextContrast(action, s.ink),
  }
}

export function deriveDarkActionTextTokens(action: string, s: DarkSurfaces): DarkActionTextTokens {
  return {
    actionText: ensureTextContrast(action, [s.background, s.muted, s.card]),
    actionTextTint: ensureTextContrast(action, tintSurfaces(action, [s.background, s.card])),
  }
}

export type ContrastFailure = { name: string; ratio: number; minRatio: number; bg: string; fg: string; hint?: string }

export function formatContrastFailure(f: ContrastFailure): string {
  return `${f.name}: ${f.ratio.toFixed(2)}:1 (need ${f.minRatio}:1)${f.hint ? ` — ${f.hint}` : ''}`
}

// HARD gate: every fg/bg pair the theme exposes that ships under WCAG AA. The
// generator derives these foregrounds/surfaces itself (pickForeground /
// ensureContrast), so a palette only fails them when its own neutrals clash.
// The Design Studio refuses a palette that fails any of them. Never throws.
export function checkThemeContrast(brand: Pick<BrandJson, 'palette'>): ContrastFailure[] {
  const { palette } = brand
  const primaryFg = pickForeground(palette.primary, palette.nearWhite, palette.nearBlack)
  const secondaryFg = pickForeground(palette.secondary, palette.nearWhite, palette.nearBlack)
  const accentFg = pickForeground(palette.complementary, palette.nearWhite, palette.nearBlack)
  const primaryBg = ensureContrast(palette.primary, primaryFg)
  const secondaryBg = ensureContrast(palette.secondary, secondaryFg)
  const accentBg = ensureContrast(palette.complementary, accentFg)
  const muted = setLightness(palette.nearWhite, 95)
  const mutedForeground = ensureContrast(setLightness(palette.nearBlack, 40), muted)
  const footerMutedText = chroma.mix(palette.nearBlack, palette.nearWhite, 0.9, 'rgb').hex()
  const ink = setLightness(chroma.mix(palette.nearBlack, palette.primary, 0.4, 'lab').hex(), 12)
  const inkFg = pickForeground(ink, palette.nearWhite, palette.nearBlack)

  return failingPairs([
    { name: 'foreground / background', bg: palette.nearWhite, fg: palette.nearBlack, minRatio: 4.5 },
    { name: 'primary-fg / primary', bg: primaryBg, fg: primaryFg, minRatio: 4.5 },
    { name: 'secondary-fg / secondary', bg: secondaryBg, fg: secondaryFg, minRatio: 4.5 },
    { name: 'accent-fg / accent', bg: accentBg, fg: accentFg, minRatio: 4.5 },
    { name: 'muted-fg / muted', bg: muted, fg: mutedForeground, minRatio: 4.5 },
    { name: 'footer muted text (text-bg/90)', bg: palette.nearBlack, fg: footerMutedText, minRatio: 4.5 },
    { name: 'ink-fg / ink', bg: ink, fg: inkFg, minRatio: 4.5 },
  ])
}

type ContrastPair = { name: string; bg: string; fg: string; minRatio: number; hint?: string }

function failingPairs(pairs: ContrastPair[]): ContrastFailure[] {
  const failures: ContrastFailure[] = []
  for (const { name, bg, fg, minRatio, hint } of pairs) {
    const ratio = chroma.contrast(bg, fg)
    if (ratio < minRatio) failures.push({ name, ratio, minRatio, bg, fg, ...(hint ? { hint } : {}) })
  }
  return failures
}

// ADVISORY (never a gate): the raw --color-action as LARGE text. Small action
// text (kickers, dates, badges) is auto-corrected by the generator
// (--color-action-text / --color-action-on-primary, 4.5:1 by construction), so
// those pairs no longer warn. What still renders the raw action as text is
// large display type — the italic headline accent word (canvas heroes on the
// page background; page-header on the primary), stat figures and the pricing
// estimate (primary) — which WCAG holds to 3:1. Theme Studio warnings only;
// the Design Studio does not use them. Rendered-text contrast (render-check,
// metrics.ts) is a separate gate.
export const ACTION_ON_PRIMARY_PAIR = 'action (large text) / primary'
export const ACTION_ON_BACKGROUND_PAIR = 'action (large text) / background'
const ACTION_ON_PRIMARY_HINT =
  'the action colour is used for large display text on the primary (page-header accent word, stat figures, price estimate) — a brighter or lighter action colour, or a darker primary, reads better'
const ACTION_ON_BACKGROUND_HINT =
  'the action colour is used for the large headline accent word on the page background — a deeper, darker action colour reads better'

export function checkActionContrast(brand: Pick<BrandJson, 'palette'>): ContrastFailure[] {
  const { palette } = brand
  const primaryFg = pickForeground(palette.primary, palette.nearWhite, palette.nearBlack)
  const primaryBg = ensureContrast(palette.primary, primaryFg)
  return failingPairs([
    { name: ACTION_ON_PRIMARY_PAIR, bg: primaryBg, fg: palette.action, minRatio: 3, hint: ACTION_ON_PRIMARY_HINT },
    { name: ACTION_ON_BACKGROUND_PAIR, bg: palette.nearWhite, fg: palette.action, minRatio: 3, hint: ACTION_ON_BACKGROUND_HINT },
  ])
}


// Regenerate the full theme.css contents from brand.json + design.json. The
// output string must match the template's generate-theme.ts exactly.
// Accepts just `{ palette }` (a full BrandJson is assignable) so the Theme
// Studio can regenerate the preview client-side without reconstructing a whole
// BrandJson.
export function generateThemeCss(brand: Pick<BrandJson, 'palette'>, design: DesignJson): string {
  const { palette } = brand
  const { spacing, radius } = design

  const primaryFg = pickForeground(palette.primary, palette.nearWhite, palette.nearBlack)
  const secondaryFg = pickForeground(palette.secondary, palette.nearWhite, palette.nearBlack)
  const accentFg = pickForeground(palette.complementary, palette.nearWhite, palette.nearBlack)

  const primaryBg = ensureContrast(palette.primary, primaryFg)
  const secondaryBg = ensureContrast(palette.secondary, secondaryFg)
  const accentBg = ensureContrast(palette.complementary, accentFg)

  const foreground = ensureContrast(palette.nearBlack, palette.nearWhite)

  const muted = setLightness(palette.nearWhite, 95)
  const mutedForeground = ensureContrast(setLightness(palette.nearBlack, 40), muted)
  const borderColor = setLightness(palette.nearWhite, 90)

  // Deep near-black "ink" section surface for the optional dark section rhythm
  // (design.json darkSections). Mixed toward the primary so it carries a hint of
  // brand hue, then floored to a very low lightness; foreground is AA-picked.
  const ink = setLightness(chroma.mix(palette.nearBlack, palette.primary, 0.4, 'lab').hex(), 12)
  const inkForeground = pickForeground(ink, palette.nearWhite, palette.nearBlack)

  const destructive = chroma.hsl(0, 0.84, 0.6).hex()

  // Dark-mode neutrals (system preference, no toggle). Only neutral surfaces/
  // text flip; brand-colour tokens keep their values.
  const darkBackground = setLightness(palette.nearBlack, 9)
  const darkForeground = ensureContrast(setLightness(palette.nearWhite, 92), darkBackground)
  const darkCard = setLightness(palette.nearBlack, 13)
  const darkMuted = setLightness(palette.nearBlack, 17)
  const darkMutedForeground = ensureContrast(setLightness(palette.nearWhite, 60), darkMuted)
  const darkBorder = setLightness(palette.nearBlack, 24)

  // Small-text action colours, AA-corrected against the RENDERED surfaces each
  // is used on (see ensureTextContrast). Exactly palette.action when it passes.
  const lightAction = deriveLightActionTextTokens(palette.action, {
    background: renderedHex(palette.nearWhite),
    muted: renderedHex(muted),
    card: renderedHex(palette.nearWhite),
    primary: renderedHex(primaryBg),
    ink,
  })
  const darkAction = deriveDarkActionTextTokens(palette.action, {
    background: renderedHex(darkBackground),
    muted: renderedHex(darkMuted),
    card: renderedHex(darkCard),
  })

  const [sr, sg, sb] = chroma(palette.primary).rgb()
  const shadowRgb = `${sr}, ${sg}, ${sb}`

  return `/* This file is generated by scripts/generate-theme.ts.
 * Edit brand.json / design.json and rerun the script instead of editing this file. */

@theme {
  /* Palette → shadcn semantic CSS variables (HSL space-separated).
   * Surface tokens use the AA-corrected backgrounds (see ensureContrast). */
  --color-primary: hsl(${toHslTokens(primaryBg)});
  --color-primary-foreground: hsl(${toHslTokens(primaryFg)});
  --color-secondary: hsl(${toHslTokens(secondaryBg)});
  --color-secondary-foreground: hsl(${toHslTokens(secondaryFg)});
  --color-accent: hsl(${toHslTokens(accentBg)});
  --color-accent-foreground: hsl(${toHslTokens(accentFg)});
  --color-background: hsl(${toHslTokens(palette.nearWhite)});
  --color-foreground: hsl(${toHslTokens(foreground)});
  --color-muted: hsl(${toHslTokens(muted)});
  --color-muted-foreground: hsl(${toHslTokens(mutedForeground)});
  --color-card: hsl(${toHslTokens(palette.nearWhite)});
  --color-card-foreground: hsl(${toHslTokens(foreground)});
  --color-popover: hsl(${toHslTokens(palette.nearWhite)});
  --color-popover-foreground: hsl(${toHslTokens(foreground)});
  --color-border: hsl(${toHslTokens(borderColor)});
  --color-input: hsl(${toHslTokens(borderColor)});
  --color-ring: hsl(${toHslTokens(palette.action)});
  --color-destructive: hsl(${toHslTokens(destructive)});
  --color-destructive-foreground: hsl(${toHslTokens(palette.nearWhite)});

  /* Custom brand tokens — used directly by block components via var() */
  --color-action: ${palette.action};
  --color-action-foreground: ${palette.nearWhite};
  /* Action colour for SMALL text, AA-corrected (lightness only) against the
   * rendered surfaces it sits on: -text on the canvas (background, muted,
   * card), -text-tint on the 10-15% action-tint badges, -on-primary / -on-ink
   * in those sections (globals.css re-scopes -text there; -text-canvas keeps
   * the canvas value for light cards inside them). Each equals --color-action
   * when the raw colour already passes. */
  --color-action-text: ${lightAction.actionText};
  --color-action-text-canvas: ${lightAction.actionText};
  --color-action-text-tint: ${lightAction.actionTextTint};
  --color-action-on-primary: ${lightAction.actionOnPrimary};
  --color-action-on-ink: ${lightAction.actionOnInk};
  --color-primary-hex: ${palette.primary};
  --color-near-black: ${palette.nearBlack};
  --color-near-white: ${palette.nearWhite};
  --color-complementary: ${palette.complementary};

  /* Footer surface — intentionally dark in BOTH light and dark mode, so the
   * footer stays a consistent dark anchor instead of inverting under the
   * .dark override below. */
  --color-footer: ${palette.nearBlack};
  --color-footer-foreground: ${palette.nearWhite};

  /* Ink section surface — optional dark section rhythm (design.json darkSections). */
  --color-ink: ${ink};
  --color-ink-foreground: ${inkForeground};

  /* Spacing scale — exposed under a c5-prefixed namespace to avoid
   * colliding with Tailwind v4's --spacing-* namespace, which feeds
   * max-w-*, w-*, h-*, p-*, m-*, gap-* utilities. Naming these tokens
   * spacing-xs/sm/md/lg/xl/2xl would silently override max-w-2xl etc.
   * Reference these in custom CSS via var(--c5-space-xs). For Tailwind
   * utility values, use the native scale (p-1=4px, p-2=8px, p-4=16px,
   * p-6=24px, p-12=48px, p-24=96px). */
  --c5-space-xs: ${spacing.xs};
  --c5-space-sm: ${spacing.sm};
  --c5-space-md: ${spacing.md};
  --c5-space-lg: ${spacing.lg};
  --c5-space-xl: ${spacing.xl};
  --c5-space-2xl: ${spacing['2xl']};

  /* Radius (from design.json) */
  --radius-none: ${radius.none};
  --radius-sm: ${radius.sm};
  --radius-md: ${radius.md};
  --radius-lg: ${radius.lg};
  --radius-pill: ${radius.pill};
  --radius: var(--radius-lg);

  /* Elevation — brand-tinted shadows (derived from the primary colour). These
   * override Tailwind's default shadow-sm/md/lg utilities AND expose a
   * shadow-card / shadow-card-hover pair for the content block cards. */
  --shadow-sm: 0 1px 2px 0 rgba(${shadowRgb}, 0.06);
  --shadow-md: 0 4px 12px -2px rgba(${shadowRgb}, 0.10);
  --shadow-lg: 0 12px 24px -6px rgba(${shadowRgb}, 0.16);
  --shadow-card: 0 2px 8px rgba(${shadowRgb}, 0.08);
  --shadow-card-hover: 0 8px 20px -4px rgba(${shadowRgb}, 0.16);

  /* Font family CSS vars — next/font sets these at runtime via className,
   * but we expose semantic names here so components can reference them */
  --font-heading: var(--font-heading-loaded, system-ui, sans-serif);
  --font-body: var(--font-body-loaded, system-ui, sans-serif);
}

:root {
  /* Duplicate in :root for shadcn components that read vars directly */
  --color-primary: hsl(${toHslTokens(primaryBg)});
  --color-primary-foreground: hsl(${toHslTokens(primaryFg)});
  --color-secondary: hsl(${toHslTokens(secondaryBg)});
  --color-secondary-foreground: hsl(${toHslTokens(secondaryFg)});
  --color-accent: hsl(${toHslTokens(accentBg)});
  --color-accent-foreground: hsl(${toHslTokens(accentFg)});
  --color-background: hsl(${toHslTokens(palette.nearWhite)});
  --color-foreground: hsl(${toHslTokens(foreground)});
  --color-muted: hsl(${toHslTokens(muted)});
  --color-muted-foreground: hsl(${toHslTokens(mutedForeground)});
  --color-card: hsl(${toHslTokens(palette.nearWhite)});
  --color-card-foreground: hsl(${toHslTokens(foreground)});
  --color-popover: hsl(${toHslTokens(palette.nearWhite)});
  --color-popover-foreground: hsl(${toHslTokens(foreground)});
  --color-border: hsl(${toHslTokens(borderColor)});
  --color-input: hsl(${toHslTokens(borderColor)});
  --color-ring: hsl(${toHslTokens(palette.action)});
  --color-destructive: hsl(${toHslTokens(destructive)});
  --color-destructive-foreground: hsl(${toHslTokens(palette.nearWhite)});

  /* Custom brand tokens */
  --color-action: ${palette.action};
  --color-action-foreground: ${palette.nearWhite};
  /* Action colour for SMALL text, AA-corrected (lightness only) against the
   * rendered surfaces it sits on: -text on the canvas (background, muted,
   * card), -text-tint on the 10-15% action-tint badges, -on-primary / -on-ink
   * in those sections (globals.css re-scopes -text there; -text-canvas keeps
   * the canvas value for light cards inside them). Each equals --color-action
   * when the raw colour already passes. */
  --color-action-text: ${lightAction.actionText};
  --color-action-text-canvas: ${lightAction.actionText};
  --color-action-text-tint: ${lightAction.actionTextTint};
  --color-action-on-primary: ${lightAction.actionOnPrimary};
  --color-action-on-ink: ${lightAction.actionOnInk};
  --color-primary-hex: ${palette.primary};
  --color-near-black: ${palette.nearBlack};
  --color-near-white: ${palette.nearWhite};
  --color-complementary: ${palette.complementary};

  /* Footer surface — intentionally dark in BOTH light and dark mode, so the
   * footer stays a consistent dark anchor instead of inverting under the
   * .dark override below. */
  --color-footer: ${palette.nearBlack};
  --color-footer-foreground: ${palette.nearWhite};

  /* Ink section surface — optional dark section rhythm (design.json darkSections). */
  --color-ink: ${ink};
  --color-ink-foreground: ${inkForeground};

  /* Spacing scale (c5-prefixed to avoid Tailwind --spacing-* collision) */
  --c5-space-xs: ${spacing.xs};
  --c5-space-sm: ${spacing.sm};
  --c5-space-md: ${spacing.md};
  --c5-space-lg: ${spacing.lg};
  --c5-space-xl: ${spacing.xl};
  --c5-space-2xl: ${spacing['2xl']};

  /* Radius */
  --radius-none: ${radius.none};
  --radius-sm: ${radius.sm};
  --radius-md: ${radius.md};
  --radius-lg: ${radius.lg};
  --radius-pill: ${radius.pill};
  --radius: var(--radius-lg);

  /* Font family */
  --font-heading: var(--font-heading-loaded, system-ui, sans-serif);
  --font-body: var(--font-body-loaded, system-ui, sans-serif);
}

/* Dark mode. Applied when the <html> element carries the .dark class, which
 * next-themes sets — for an explicit "dark" choice AND for "system" when the
 * visitor's OS prefers dark (defaultTheme="system"). A class selector (rather
 * than @media prefers-color-scheme) is what lets a visitor pin "light" even on
 * a dark-OS device. Flips only the neutral surfaces + text; brand colour tokens
 * and the footer are intentionally left untouched so colored heros, buttons,
 * and CTAs render identically and stay on-brand. */
.dark {
  --color-background: hsl(${toHslTokens(darkBackground)});
  --color-foreground: hsl(${toHslTokens(darkForeground)});
  --color-card: hsl(${toHslTokens(darkCard)});
  --color-card-foreground: hsl(${toHslTokens(darkForeground)});
  --color-popover: hsl(${toHslTokens(darkCard)});
  --color-popover-foreground: hsl(${toHslTokens(darkForeground)});
  --color-muted: hsl(${toHslTokens(darkMuted)});
  --color-muted-foreground: hsl(${toHslTokens(darkMutedForeground)});
  --color-border: hsl(${toHslTokens(darkBorder)});
  --color-input: hsl(${toHslTokens(darkBorder)});
  /* Small action text re-corrected for the dark neutral surfaces. */
  --color-action-text: ${darkAction.actionText};
  --color-action-text-canvas: ${darkAction.actionText};
  --color-action-text-tint: ${darkAction.actionTextTint};
}
`
}
