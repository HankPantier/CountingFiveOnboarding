// Server-only (via css-sanitizer). Pure conversion between a DesignBundle and
// the client repo's theme files. brand.json + design.json are rewritten in
// place (non-design fields untouched, 2-space + trailing newline); theme.css is
// ALWAYS regenerated; design-overrides.css gets a single Studio-managed region
// that is replaced wholesale on every apply. Nothing here touches the network.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { patchDesignFlags } from '@/lib/editor/theme-edit'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { gfUrl } from '@/lib/content/type-pairing-catalog'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import { parseDesignBundle, type DesignBundle } from './bundle'
import { sanitizeDesignCss } from './css-sanitizer'
import { CSS_TARGETS, isCssTarget, type CssTarget } from './css-targets'
import { totalCssErrors } from './css-budget'

export const REGION_BEGIN = '/* design-studio:begin */'
export const REGION_END = '/* design-studio:end */'
export const MANAGED_HEADER =
  '/* design-overrides.css — managed by the Revaltus Design Studio.\n * The design-studio region below is regenerated on every apply; edit it through the Studio. */\n'

export type RepoThemeFiles = { brandText: string; designText: string; overridesCss: string }
export type RenderedThemeFiles = { brandText: string; designText: string; themeCss: string; overridesCss: string; fontsModule?: string }
// readRegion's throw-free signal: `ok: false` means the file's design-studio
// markers are malformed (never guessed at — see regionStatus below).
export type ReadRegionResult = { ok: true; css: DesignBundle['css'] } | { ok: false }

export const MALFORMED_REGION_ERROR =
  'content/design-overrides.css has malformed design-studio region markers — fix by hand or apply with removeLegacy.'

const serialize = (obj: unknown): string => JSON.stringify(obj, null, 2) + '\n'
const fragStart = (key: string) => `/* design-studio:${key} */`
const fragEnd = (key: string) => `/* /design-studio:${key} */`

// Repos may have been saved with CRLF line endings (Windows editors, some git
// autocrlf configs). Normalize before any marker/region parsing so a CRLF
// round-trip never looks malformed and never leaks \r into rewritten files.
const normalizeNewlines = (css: string): string => css.replace(/\r\n/g, '\n')

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return count
    count++
    from = idx + needle.length
  }
}

type RegionStatus = { kind: 'none' } | { kind: 'valid'; start: number; end: number } | { kind: 'malformed' }

// A well-formed overrides file has either no markers at all, or exactly one
// begin and one end with the begin first. Anything else (a stray extra begin,
// two separate regions, an orphaned begin or end) is refused rather than
// guessed at — guessing which begin/end pair is "the real one" is exactly
// what silently drops hand-written CSS.
function regionStatus(normalizedCss: string): RegionStatus {
  const begins = countOccurrences(normalizedCss, REGION_BEGIN)
  const ends = countOccurrences(normalizedCss, REGION_END)
  if (begins === 0 && ends === 0) return { kind: 'none' }
  if (begins === 1 && ends === 1) {
    const start = normalizedCss.indexOf(REGION_BEGIN)
    const end = normalizedCss.indexOf(REGION_END)
    if (start < end) return { kind: 'valid', start, end: end + REGION_END.length }
  }
  return { kind: 'malformed' }
}

export function readRegion(overridesCss: string): ReadRegionResult {
  const css = normalizeNewlines(overridesCss)
  const status = regionStatus(css)
  if (status.kind === 'malformed') return { ok: false }
  const out: DesignBundle['css'] = { blocks: {} }
  if (status.kind === 'none') return { ok: true, css: out }
  const region = css.slice(status.start, status.end)
  const re = /\/\* design-studio:([a-z-]+) \*\/\n([\s\S]*?)\n\/\* \/design-studio:\1 \*\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    const [, key, body] = m
    if (key === 'global') out.global = body
    else if (isCssTarget(key)) out.blocks[key] = body
  }
  return { ok: true, css: out }
}

export function removeRegion(overridesCss: string): string {
  const css = normalizeNewlines(overridesCss)
  const status = regionStatus(css)
  // Malformed input is left untouched rather than guessed at — callers that
  // must write (bundleToRepoFiles) gate on regionStatus themselves and never
  // reach here with malformed text unless removeLegacy discards it anyway.
  if (status.kind !== 'valid') return css.trimEnd()
  // Collapse the join so removing a mid-file region leaves at most one blank
  // line, instead of stacking the region's own surrounding blank lines.
  const before = css.slice(0, status.start).replace(/\n+$/, '')
  const after = css.slice(status.end).replace(/^\n+/, '')
  const joined = before && after ? `${before}\n\n${after}` : before || after
  return joined.trimEnd()
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

// Whether design-overrides.css holds hand-written CSS OUTSIDE the Studio
// region (comments, incl. the managed header, don't count). A malformed region
// counts as legacy — nothing outside it can be told apart safely.
export function hasLegacyOverrides(overridesCss: string): boolean {
  const outside = removeRegion(overridesCss)
  return outside.replace(/\/\*[\s\S]*?\*\//g, '').trim() !== ''
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
  const region = readRegion(files.overridesCss)
  if (!region.ok) return { ok: false, errors: [MALFORMED_REGION_ERROR] }
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
    css: region.css,
    meta: { source: meta.source },
  })
}

export function bundleToRepoFiles(
  bundle: DesignBundle,
  current: RepoThemeFiles,
  opts: { removeLegacy: boolean; fontsModule?: boolean }
): { ok: true; files: RenderedThemeFiles; css: DesignBundle['css'] } | { ok: false; errors: string[] } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(current.brandText) as BrandJson
    design = JSON.parse(current.designText) as DesignJson
  } catch {
    return { ok: false, errors: ['brand.json / design.json is not valid JSON.'] }
  }

  // Malformed markers in the file we're about to partially rewrite are fatal
  // unless removeLegacy is set — removeLegacy discards everything outside the
  // region anyway, so there's nothing to guess at.
  const normalizedOverrides = normalizeNewlines(current.overridesCss)
  if (!opts.removeLegacy && regionStatus(normalizedOverrides).kind === 'malformed') {
    return { ok: false, errors: [MALFORMED_REGION_ERROR] }
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
  const totalErrors = totalCssErrors([clean.global, ...Object.values(clean.blocks)])
  if (totalErrors.length) return { ok: false, errors: totalErrors }

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

  const base = (opts.removeLegacy ? MANAGED_HEADER : removeRegion(normalizedOverrides)).trimEnd()
  const region = composeRegion(clean)
  const overridesCss = region ? (base ? `${base}\n\n${region}` : region) : base ? `${base}\n` : ''

  return {
    ok: true,
    files: {
      brandText: serialize(nextBrand),
      designText: flagged.next,
      themeCss: generateThemeCss(nextBrand, flagged.design),
      overridesCss,
      // L2+ drafts only (caller decides from the DRAFT marker): the generated
      // next/font module, always derived — never hand-edited.
      ...(opts.fontsModule ? { fontsModule: generateFontsModule(flagged.design.typography).source } : {}),
    },
    // The sanitized, canonical fragments that were actually written — later
    // phases should store this, not the bundle's pre-sanitize css, as the
    // record of what's on disk.
    css: clean,
  }
}
