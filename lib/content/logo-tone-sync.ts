import type { BrandJson } from '@/types/brand-json'

// Keeps brand.json `logo.tone` honest when a live site's logo file is replaced.
// The package assembler derives the tone once, at first deploy (logo-preflight
// applyLogoTone). After that, replacing the logo in the editor's media library
// only swapped the image, so a dark replacement kept `tone: "light"` (no plate,
// invisible on a light nav) and a light replacement never got it. The editor's
// asset route now re-runs the light-logo detection and uses these pure helpers
// to set or clear the key in the same commit as the new image.

export const BRAND_JSON_PATH = 'content/brand.json'
const ASSET_ROOT = 'public/content-assets/'

/**
 * The repo path brand.json's `logo.primary` points at, or null when there is
 * none (empty, an absolute URL, or anything that is not a plain asset name).
 * The assembler ships the logo at public/content-assets/{filename}; a value
 * written as `/content-assets/x.png` or `content-assets/x.png` means the same.
 */
export function brandLogoAssetPath(logoPrimary: unknown): string | null {
  if (typeof logoPrimary !== 'string') return null
  let name = logoPrimary.trim()
  if (!name || /^[a-z][a-z0-9+.-]*:/i.test(name) || name.startsWith('//')) return null
  name = name.replace(/^\/+/, '')
  if (name.startsWith('public/')) name = name.slice('public/'.length)
  if (name.startsWith('content-assets/')) name = name.slice('content-assets/'.length)
  if (!name || name.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  return `${ASSET_ROOT}${name}`
}

/**
 * Whether `assetPath` (an already-normalized public/content-assets/ path) is
 * the logo that brand.json references. Case-sensitive, like the repo.
 */
export function isBrandLogoPath(brandText: string, assetPath: string): boolean {
  const brand = parseBrand(brandText)
  if (!brand) return false
  return brandLogoAssetPath(brand.logo?.primary) === assetPath
}

/**
 * brand.json text with `logo.tone` set to "light" (a light logo) or removed (a
 * dark one), or null when nothing changes or the file can't be parsed. Every
 * other byte of structure is preserved; output uses the repo's 2-space JSON +
 * trailing newline convention.
 *
 * An explicit `tone: "dark"` (an operator's choice) is kept unless the new logo
 * is conclusively light. Callers only get here with a conclusive detection
 * (logo-preflight `toneConclusive`); an inconclusive one never retones.
 */
export function retoneBrandJson(brandText: string, lightLogo: boolean): string | null {
  const brand = parseBrand(brandText)
  if (!brand || !brand.logo || typeof brand.logo !== 'object') return null
  const current = brand.logo.tone
  if (lightLogo ? current === 'light' : current === undefined || current === 'dark') return null
  const logo: BrandJson['logo'] = { ...brand.logo }
  if (lightLogo) logo.tone = 'light'
  else delete logo.tone
  return JSON.stringify({ ...brand, logo }, null, 2) + '\n'
}

function parseBrand(text: string): BrandJson | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as BrandJson) : null
  } catch {
    return null
  }
}
