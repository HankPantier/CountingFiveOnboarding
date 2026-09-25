// Pure + client-safe. Has the draft's theme drifted from the latest Design
// Studio version? Compares git blob shas of the four theme files (content-
// addressed: equal bytes ⇔ equal sha) with the version's applied_blobs. Also
// flags a committed theme.css that no longer matches brand.json + design.json.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '@/app/api/edit/[id]/theme/_theme'
import type { DriftResult, ThemeBlobShas } from './studio-types'

export const THEME_FILE_PATHS = [BRAND_PATH, DESIGN_PATH, THEME_CSS_PATH, OVERRIDES_PATH] as const
export type ThemeFilePath = (typeof THEME_FILE_PATHS)[number]

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i

export function toBlobMap(value: unknown): ThemeBlobShas {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ThemeBlobShas = {}
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string' && SHA_RE.test(v)) out[k] = v
  return out
}

export function computeDrift(
  current: ThemeBlobShas,
  latest: { versionNo: number; appliedBlobs: ThemeBlobShas } | null
): DriftResult {
  if (!latest) return { status: 'no-baseline', changedPaths: [], sinceVersion: null }
  const changedPaths = THEME_FILE_PATHS.filter((p) => (current[p] ?? null) !== (latest.appliedBlobs[p] ?? null))
  return { status: changedPaths.length ? 'drifted' : 'in-sync', changedPaths, sinceVersion: latest.versionNo }
}

// true = theme.css is missing or differs from what brand.json + design.json
// generate (e.g. a platform-seeded site that never had theme.css written);
// null = brand/design missing or unparseable, so we can't tell.
export function isThemeCssStale(texts: Partial<Record<ThemeFilePath, string>>): boolean | null {
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

// The FULL post-apply blob map of the four theme files (the design_versions.
// applied_blobs contract): shas from `shas`, overridden by `written`. Used as
// the fallback when the post-apply snapshot can't be read.
export function mergeAppliedBlobs(shas: ThemeBlobShas, written: Record<string, string>): ThemeBlobShas {
  const out: ThemeBlobShas = {}
  for (const p of THEME_FILE_PATHS) {
    const sha = written[p] ?? shas[p]
    if (sha) out[p] = sha
  }
  return out
}
