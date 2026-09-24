// Server-only (via css-sanitizer). Pure conversion between a DesignBundle and
// the client repo's theme files. brand.json + design.json are rewritten in
// place (non-design fields untouched, 2-space + trailing newline); theme.css is
// ALWAYS regenerated; design-overrides.css gets a single Studio-managed region
// that is replaced wholesale on every apply. Nothing here touches the network.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { patchDesignFlags } from '@/lib/editor/theme-edit'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { gfUrl } from '@/lib/content/type-pairing-catalog'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import { parseDesignBundle, type DesignBundle } from './bundle'
import { sanitizeDesignCss } from './css-sanitizer'
import { CSS_TARGETS, isCssTarget, type CssTarget } from './css-targets'

export const REGION_BEGIN = '/* design-studio:begin */'
export const REGION_END = '/* design-studio:end */'
export const MANAGED_HEADER =
  '/* design-overrides.css — managed by the Revaltus Design Studio.\n * The design-studio region below is regenerated on every apply; edit it through the Studio. */\n'

export type RepoThemeFiles = { brandText: string; designText: string; overridesCss: string }
export type RenderedThemeFiles = { brandText: string; designText: string; themeCss: string; overridesCss: string }

const serialize = (obj: unknown): string => JSON.stringify(obj, null, 2) + '\n'
const fragStart = (key: string) => `/* design-studio:${key} */`
const fragEnd = (key: string) => `/* /design-studio:${key} */`

function regionBounds(css: string): { start: number; end: number } | null {
  const start = css.indexOf(REGION_BEGIN)
  if (start === -1) return null
  const endIdx = css.indexOf(REGION_END, start)
  if (endIdx === -1) return null
  return { start, end: endIdx + REGION_END.length }
}

export function readRegion(overridesCss: string): DesignBundle['css'] {
  const out: DesignBundle['css'] = { blocks: {} }
  const b = regionBounds(overridesCss)
  if (!b) return out
  const region = overridesCss.slice(b.start, b.end)
  const re = /\/\* design-studio:([a-z-]+) \*\/\n([\s\S]*?)\n\/\* \/design-studio:\1 \*\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    const [, key, body] = m
    if (key === 'global') out.global = body
    else if (isCssTarget(key)) out.blocks[key] = body
  }
  return out
}

export function removeRegion(overridesCss: string): string {
  const b = regionBounds(overridesCss)
  if (!b) return overridesCss.trimEnd()
  return (overridesCss.slice(0, b.start) + overridesCss.slice(b.end)).trimEnd()
}

export function composeRegion(css: DesignBundle['css']): string {
  const parts: string[] = []
  if (css.global?.trim()) parts.push(`${fragStart('global')}\n${css.global.trim()}\n${fragEnd('global')}`)
  for (const key of CSS_TARGETS) {
    const body = css.blocks[key]?.trim()
    if (body) parts.push(`${fragStart(key)}\n${body}\n${fragEnd(key)}`)
  }
  if (parts.length === 0) return ''
  return `${REGION_BEGIN}\n${parts.join('\n')}\n${REGION_END}\n`
}

export function bundleFromRepoFiles(
  files: RepoThemeFiles,
  meta: { name: string; source: DesignBundle['meta']['source'] }
): { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(files.brandText) as BrandJson
    design = JSON.parse(files.designText) as DesignJson
  } catch {
    return { ok: false, errors: ['brand.json / design.json is not valid JSON.'] }
  }
  const t = normalizeTypography(design.typography)
  return parseDesignBundle({
    schemaVersion: 1,
    name: meta.name,
    palette: brand.palette,
    typography: { headingFont: t.headingFont, bodyFont: t.bodyFont, accentFont: t.accentFont },
    tokens: {
      roundness: design.roundness,
      density: design.density,
      visualFeel: design.visualFeel,
      spacing: design.spacing,
      radius: design.radius,
    },
    treatments: {
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
    },
    css: readRegion(files.overridesCss),
    meta: { source: meta.source },
  })
}

export function bundleToRepoFiles(
  bundle: DesignBundle,
  current: RepoThemeFiles,
  opts: { removeLegacy: boolean }
): { ok: true; files: RenderedThemeFiles } | { ok: false; errors: string[] } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(current.brandText) as BrandJson
    design = JSON.parse(current.designText) as DesignJson
  } catch {
    return { ok: false, errors: ['brand.json / design.json is not valid JSON.'] }
  }

  // Sanitize every CSS fragment first — nothing is written if any fails.
  const errors: string[] = []
  const clean: DesignBundle['css'] = { blocks: {} }
  if (bundle.css.global?.trim()) {
    const r = sanitizeDesignCss(bundle.css.global, { kind: 'global' })
    if (r.ok) clean.global = r.css
    else errors.push(...r.errors.map((e) => `css.global: ${e}`))
  }
  for (const [key, body] of Object.entries(bundle.css.blocks) as [CssTarget, string | undefined][]) {
    if (!body?.trim()) continue
    const r = sanitizeDesignCss(body, { kind: 'target', target: key })
    if (r.ok) clean.blocks[key] = r.css
    else errors.push(...r.errors.map((e) => `css.blocks.${key}: ${e}`))
  }
  if (errors.length) return { ok: false, errors }

  const nextBrand: BrandJson = { ...brand, palette: { ...brand.palette, ...bundle.palette } }

  const { headingFont, bodyFont, accentFont } = bundle.typography
  const typography = {
    ...design.typography,
    headingFont,
    bodyFont,
    accentFont,
    googleFontsUrl: gfUrl(Array.from(new Set([headingFont, bodyFont, accentFont]))),
  }
  const merged: DesignJson = {
    ...design,
    typography,
    roundness: bundle.tokens.roundness,
    density: bundle.tokens.density,
    visualFeel: bundle.tokens.visualFeel,
    spacing: { ...bundle.tokens.spacing },
    radius: { ...bundle.tokens.radius },
  }
  // Reuse the flag patcher so treatments are omitted-at-default exactly like the
  // Theme Studio controls write them.
  const flagged = patchDesignFlags(serialize(merged), bundle.treatments)
  if (!flagged.ok) return { ok: false, errors: [flagged.reason] }

  const base = (opts.removeLegacy ? MANAGED_HEADER : removeRegion(current.overridesCss)).trimEnd()
  const region = composeRegion(clean)
  const overridesCss = region ? (base ? `${base}\n\n${region}` : region) : base ? `${base}\n` : ''

  return {
    ok: true,
    files: {
      brandText: serialize(nextBrand),
      designText: flagged.next,
      themeCss: generateThemeCss(nextBrand, flagged.design),
      overridesCss,
    },
  }
}
