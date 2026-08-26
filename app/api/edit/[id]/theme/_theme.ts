import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { gfUrl } from '@/lib/content/type-pairing-catalog'

// The four files the theme editor owns in a client site repo. brand.json +
// design.json are the source of truth; theme.css is regenerated from them (never
// hand-edited); design-overrides.css holds per-block polish.
export const BRAND_PATH = 'content/brand.json'
export const DESIGN_PATH = 'content/design.json'
export const OVERRIDES_PATH = 'content/design-overrides.css'
export const THEME_CSS_PATH = 'src/styles/theme.css'

export type ThemeSources = {
  palette: BrandJson['palette']
  typography: DesignJson['typography']
  roundness: DesignJson['roundness']
  density: DesignJson['density']
  visualFeel: DesignJson['visualFeel']
  spacing: DesignJson['spacing']
  radius: DesignJson['radius']
  /** The client's committed theme.css on draft — the real artifact the preview renders. */
  themeCss: string
  /** Per-client design-overrides.css on draft. */
  overridesCss: string
}

// design.json files packaged before the Ink & Clay `accentFont` slot existed
// (and, defensively, any with a partial typography object) are missing font
// fields. Fill them with the template defaults so every consumer — the Theme
// Studio preview (compose-srcdoc), the font selectors, and generateThemeCss —
// always receives a complete typography and never calls a string method on
// undefined. Defaults mirror lib/content/design-json-builder.ts.
export function normalizeTypography(
  t: Partial<DesignJson['typography']> | undefined,
): DesignJson['typography'] {
  const headingFont = t?.headingFont || 'Public Sans'
  const bodyFont = t?.bodyFont || 'Public Sans'
  const accentFont = t?.accentFont || 'Fraunces'
  const googleFontsUrl =
    t?.googleFontsUrl || gfUrl(Array.from(new Set([headingFont, bodyFont, accentFont])))
  return { headingFont, bodyFont, accentFont, googleFontsUrl }
}

export type PreviewUrlInfo = {
  /** Operator override stored on content_jobs (what the preview fetches when set). */
  previewUrl: string | null
  /** Canonical site.config.ts siteUrl on main — the fallback when no override. */
  configUrl: string | null
  /** What the preview will actually fetch: previewUrl ?? configUrl. */
  effectiveUrl: string | null
}
