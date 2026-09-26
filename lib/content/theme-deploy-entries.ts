// ---------------------------------------------------------------------------
// The theme files a packaged deploy ships alongside content/ + public/. Pure.
//
// Generated from the SAME brand/design objects the package writes to
// content/brand.json + content/design.json, exactly the way the Theme Studio
// Controls route (app/api/edit/[id]/theme/route.ts) builds them, so a
// deploy-written file and a Controls-written file are byte-identical for the
// same design.json.
//
//   - src/styles/theme.css — always.
//   - src/app/fonts.generated.ts — ONLY when the DRAFT branch's c5-template.json
//     declares `fonts` (T1+ templates). Pre-T1 templates have no importer for
//     it, so a stray module would just be noise.
//
// Both are site config (SITE_CONFIG_PATHS in deploy-plan.ts): the first deploy
// overlays them over the template-seeded defaults; later deploys only create
// them when absent on draft and never overwrite them.
//
// R1 note: on a T1+ template a FIRST deploy therefore makes the live fonts
// follow design.json (the SYNCED module replaces the template's DEFAULT one).
// That is the intended outcome for a brand-new site — the pipeline chose those
// fonts. Already-deployed sites are unaffected: after their first deploy the
// module is site config owned by Design Studio / Theme Studio Controls.
//
// The paths are a fixed allowlist — never derived from anything client-supplied.
// ---------------------------------------------------------------------------
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { THEME_CSS_PATH, normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import { fontsUnlocked, parseTemplateMarker } from '@/lib/design/capabilities'
import { FONTS_MODULE_PATH } from '@/lib/design/drift'

export type ThemeDeployInput = {
  brandJson: BrandJson
  designJson: DesignJson
  /** The draft branch's c5-template.json text; null when absent. */
  markerText: string | null
}

export function themeDeployEntries({ brandJson, designJson, markerText }: ThemeDeployInput): { path: string; content: string }[] {
  const out = [{ path: THEME_CSS_PATH, content: generateThemeCss(brandJson, designJson) }]
  if (fontsUnlocked(parseTemplateMarker(markerText))) {
    out.push({ path: FONTS_MODULE_PATH, content: generateFontsModule(normalizeTypography(designJson.typography)).source })
  }
  return out
}
