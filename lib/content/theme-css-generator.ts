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

export type ContrastFailure = { name: string; ratio: number; minRatio: number; bg: string; fg: string }

// Report every fg/bg pair the theme exposes that ships under WCAG AA, so the
// caller can surface it to the operator. Never throws.
export function checkThemeContrast(brand: BrandJson): ContrastFailure[] {
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

  const pairs: Array<{ name: string; bg: string; fg: string; minRatio: number }> = [
    { name: 'foreground / background', bg: palette.nearWhite, fg: palette.nearBlack, minRatio: 4.5 },
    { name: 'primary-fg / primary', bg: primaryBg, fg: primaryFg, minRatio: 4.5 },
    { name: 'secondary-fg / secondary', bg: secondaryBg, fg: secondaryFg, minRatio: 4.5 },
    { name: 'accent-fg / accent', bg: accentBg, fg: accentFg, minRatio: 4.5 },
    { name: 'muted-fg / muted', bg: muted, fg: mutedForeground, minRatio: 4.5 },
    { name: 'footer muted text (text-bg/90)', bg: palette.nearBlack, fg: footerMutedText, minRatio: 4.5 },
  ]
  const failures: ContrastFailure[] = []
  for (const { name, bg, fg, minRatio } of pairs) {
    const ratio = chroma.contrast(bg, fg)
    if (ratio < minRatio) failures.push({ name, ratio, minRatio, bg, fg })
  }
  return failures
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

  const destructive = chroma.hsl(0, 0.84, 0.6).hex()

  // Dark-mode neutrals (system preference, no toggle). Only neutral surfaces/
  // text flip; brand-colour tokens keep their values.
  const darkBackground = setLightness(palette.nearBlack, 9)
  const darkForeground = ensureContrast(setLightness(palette.nearWhite, 92), darkBackground)
  const darkCard = setLightness(palette.nearBlack, 13)
  const darkMuted = setLightness(palette.nearBlack, 17)
  const darkMutedForeground = ensureContrast(setLightness(palette.nearWhite, 60), darkMuted)
  const darkBorder = setLightness(palette.nearBlack, 24)

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
  --color-primary-hex: ${palette.primary};
  --color-near-black: ${palette.nearBlack};
  --color-near-white: ${palette.nearWhite};
  --color-complementary: ${palette.complementary};

  /* Footer surface — intentionally dark in BOTH light and dark mode, so the
   * footer stays a consistent dark anchor instead of inverting under the
   * .dark override below. */
  --color-footer: ${palette.nearBlack};
  --color-footer-foreground: ${palette.nearWhite};

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
  --color-primary-hex: ${palette.primary};
  --color-near-black: ${palette.nearBlack};
  --color-near-white: ${palette.nearWhite};
  --color-complementary: ${palette.complementary};

  /* Footer surface — intentionally dark in BOTH light and dark mode, so the
   * footer stays a consistent dark anchor instead of inverting under the
   * .dark override below. */
  --color-footer: ${palette.nearBlack};
  --color-footer-foreground: ${palette.nearWhite};

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
}
`
}
