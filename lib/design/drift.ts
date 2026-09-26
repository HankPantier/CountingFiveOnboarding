// Pure + client-safe. Has the draft's theme drifted from the latest Design
// Studio version? Compares git blob shas of the four theme files (content-
// addressed: equal bytes ⇔ equal sha) with the version's applied_blobs. Also
// flags a committed theme.css that no longer matches brand.json + design.json,
// and a committed fonts module (src/app/fonts.generated.ts) that no longer
// matches design.json typography (L2+ drafts only).
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH, normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import type { DesignCapabilities } from './run-types'
import { fontsUnlocked } from './capabilities'
import type { DriftResult, ThemeBlobShas } from './studio-types'

export const THEME_FILE_PATHS = [BRAND_PATH, DESIGN_PATH, THEME_CSS_PATH, OVERRIDES_PATH] as const
export type ThemeFilePath = (typeof THEME_FILE_PATHS)[number]

// The generated next/font module (template T1). Part of the theme ONLY on
// drafts whose template marker declares `fonts` (L2+): applied_blobs and drift
// then track five files. Callers pass themeFilePaths(draftCaps).
export const FONTS_MODULE_PATH = 'src/app/fonts.generated.ts'
export const SNAPSHOT_PATHS = [...THEME_FILE_PATHS, FONTS_MODULE_PATH] as const
export type SnapshotPath = (typeof SNAPSHOT_PATHS)[number]

export function themeFilePaths(draftCaps: DesignCapabilities): readonly SnapshotPath[] {
  return fontsUnlocked(draftCaps) ? SNAPSHOT_PATHS : THEME_FILE_PATHS
}

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i

export function toBlobMap(value: unknown): ThemeBlobShas {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ThemeBlobShas = {}
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string' && SHA_RE.test(v)) out[k] = v
  return out
}

export function computeDrift(
  current: ThemeBlobShas,
  latest: { versionNo: number; appliedBlobs: ThemeBlobShas } | null,
  paths: readonly string[] = THEME_FILE_PATHS
): DriftResult {
  if (!latest) return { status: 'no-baseline', changedPaths: [], sinceVersion: null }
  // Compat: versions recorded before P6a (or on an L1 draft) have no fonts
  // sha — the fonts module is compared only once a version recorded it.
  const compared = paths.filter((p) => p !== FONTS_MODULE_PATH || latest.appliedBlobs[p] !== undefined)
  const changedPaths = compared.filter((p) => (current[p] ?? null) !== (latest.appliedBlobs[p] ?? null))
  return { status: changedPaths.length ? 'drifted' : 'in-sync', changedPaths, sinceVersion: latest.versionNo }
}

// true = theme.css is missing or differs from what brand.json + design.json
// generate (e.g. a platform-seeded site that never had theme.css written);
// null = brand/design missing or unparseable, so we can't tell.
export function isThemeCssStale(texts: Partial<Record<SnapshotPath, string>>): boolean | null {
  const brandText = texts[BRAND_PATH]
  const designText = texts[DESIGN_PATH]
  if (!brandText || !designText) return null
  try {
    const brand = JSON.parse(brandText) as BrandJson
    const design = JSON.parse(designText) as DesignJson
    return generateThemeCss(brand, design) !== (texts[THEME_CSS_PATH] ?? '')
  } catch {
    return null
  }
}

// true = the committed fonts module no longer matches design.json typography
// (e.g. a fleet-seeded default module on a site whose design.json names other
// fonts); null = no module on the draft, or design.json unreadable.
export function isFontsModuleStale(texts: Partial<Record<SnapshotPath, string>>): boolean | null {
  const moduleText = texts[FONTS_MODULE_PATH]
  const designText = texts[DESIGN_PATH]
  if (moduleText === undefined || !designText) return null
  try {
    const design = JSON.parse(designText) as Partial<DesignJson>
    return generateFontsModule(normalizeTypography(design.typography)).source !== moduleText
  } catch {
    return null
  }
}

// The FULL post-apply blob map (the applied_blobs contract): the four theme
// files, plus the fonts module when `paths` includes it (L2+ drafts).
export function mergeAppliedBlobs(shas: ThemeBlobShas, written: Record<string, string>, paths: readonly string[] = THEME_FILE_PATHS): ThemeBlobShas {
  const out: ThemeBlobShas = {}
  for (const p of paths) {
    const sha = written[p] ?? shas[p]
    if (sha) out[p] = sha
  }
  return out
}
