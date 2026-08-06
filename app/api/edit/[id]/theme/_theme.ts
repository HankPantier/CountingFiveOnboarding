import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

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
