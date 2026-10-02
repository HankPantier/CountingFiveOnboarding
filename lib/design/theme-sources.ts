// Server-only. Read a client site's current theme sources from the DRAFT
// branch — shared by the Theme Studio GET route and the Design Studio renderer
// (which composes the draft theme onto the live page shell).
import { DRAFT_BRANCH, ensureDraftBranch, readFile, FileNotFoundError } from '@/lib/github/repo-files'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import {
  BRAND_PATH,
  DESIGN_PATH,
  OVERRIDES_PATH,
  THEME_CSS_PATH,
  normalizeTypography,
  type ThemeSources,
} from '@/app/api/edit/[id]/theme/_theme'
import { normalizeStyleAxes } from './style-axes'
import { logoSizeOf } from './logo-size'
import { normalizeLayoutPresets } from './layout-presets'
import { brandLogoAssetPath } from '@/lib/content/logo-tone-sync'

async function readOr(githubRepo: string, path: string, fallback: string): Promise<string> {
  try {
    return (await readFile(githubRepo, path, DRAFT_BRANCH)).content
  } catch (err) {
    if (err instanceof FileNotFoundError) return fallback
    throw err
  }
}

export async function loadDraftThemeSources(
  githubRepo: string
): Promise<{ ok: true; sources: ThemeSources } | { ok: false; status: 409 | 422; error: string }> {
  await ensureDraftBranch(githubRepo)
  let brandText = ''
  let brandSha = ''
  try {
    const f = await readFile(githubRepo, BRAND_PATH, DRAFT_BRANCH)
    brandText = f.content
    brandSha = f.sha
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
  }
  const designText = await readOr(githubRepo, DESIGN_PATH, '')
  if (!brandText || !designText) {
    return { ok: false, status: 409, error: 'This site has no brand.json / design.json yet — theme editing is unavailable.' }
  }
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(brandText) as BrandJson
    design = JSON.parse(designText) as DesignJson
  } catch {
    return { ok: false, status: 422, error: 'brand.json / design.json is not valid JSON.' }
  }
  const themeCss = await readOr(githubRepo, THEME_CSS_PATH, '')
  const overridesCss = await readOr(githubRepo, OVERRIDES_PATH, '')
  return {
    ok: true,
    sources: {
      palette: brand.palette,
      typography: normalizeTypography(design.typography),
      roundness: design.roundness,
      density: design.density,
      visualFeel: design.visualFeel,
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
      logoSize: logoSizeOf(design),
      spacing: design.spacing,
      radius: design.radius,
      style: normalizeStyleAxes(design.style),
      layout: normalizeLayoutPresets(design.layout),
      themeCss,
      overridesCss,
      logo: {
        primary: brandLogoAssetPath(brand.logo?.primary),
        footer: brandLogoAssetPath(brand.logo?.footer),
        tone: brand.logo?.tone === 'light' || brand.logo?.tone === 'dark' ? brand.logo.tone : null,
      },
      brandSha,
    },
  }
}
