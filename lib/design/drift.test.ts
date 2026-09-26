import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  THEME_FILE_PATHS,
  FONTS_MODULE_PATH,
  computeDrift,
  isThemeCssStale,
  isFontsModuleStale,
  mergeAppliedBlobs,
  themeFilePaths,
  toBlobMap,
} from './drift'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { parseTemplateMarker } from './capabilities'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const SNAP = { 'content/brand.json': A, 'content/design.json': B, 'src/styles/theme.css': C }

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
const brand = readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')
const design = readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')
const themeCss = readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8')

describe('THEME_FILE_PATHS', () => {
  it('lists the four theme files in a stable order', () => {
    expect(THEME_FILE_PATHS).toEqual(['content/brand.json', 'content/design.json', 'src/styles/theme.css', 'content/design-overrides.css'])
  })
})

describe('computeDrift', () => {
  it('is no-baseline without a version', () => {
    expect(computeDrift(SNAP, null)).toEqual({ status: 'no-baseline', changedPaths: [], sinceVersion: null })
  })

  it('is in-sync when every theme blob matches', () => {
    expect(computeDrift(SNAP, { versionNo: 2, appliedBlobs: { ...SNAP } })).toEqual({ status: 'in-sync', changedPaths: [], sinceVersion: 2 })
  })

  it('reports changed paths in THEME_FILE_PATHS order', () => {
    const r = computeDrift({ ...SNAP, 'src/styles/theme.css': D, 'content/brand.json': D }, { versionNo: 1, appliedBlobs: SNAP })
    expect(r).toEqual({ status: 'drifted', changedPaths: ['content/brand.json', 'src/styles/theme.css'], sinceVersion: 1 })
  })

  it('counts a file added or removed on draft as drift', () => {
    expect(computeDrift({ ...SNAP, 'content/design-overrides.css': D }, { versionNo: 0, appliedBlobs: SNAP }).changedPaths).toEqual([
      'content/design-overrides.css',
    ])
    const { 'content/brand.json': _gone, ...rest } = SNAP
    expect(computeDrift(rest, { versionNo: 0, appliedBlobs: SNAP }).changedPaths).toEqual(['content/brand.json'])
  })

  it('ignores non-theme paths', () => {
    expect(computeDrift(SNAP, { versionNo: 0, appliedBlobs: { ...SNAP, 'content/pages/home.md': D } }).status).toBe('in-sync')
  })
})

describe('toBlobMap', () => {
  it('keeps only string sha values', () => {
    expect(toBlobMap({ a: A, b: 12, c: 'not-a-sha', d: null })).toEqual({ a: A })
  })
  it.each([[null], [[A]], ['x'], [undefined]])('returns {} for %j', (v) => {
    expect(toBlobMap(v)).toEqual({})
  })
})

describe('isThemeCssStale', () => {
  const base = { 'content/brand.json': brand, 'content/design.json': design }
  it('is false when theme.css matches the generator', () => {
    expect(isThemeCssStale({ ...base, 'src/styles/theme.css': themeCss })).toBe(false)
  })
  it('is true when theme.css differs or is missing', () => {
    expect(isThemeCssStale({ ...base, 'src/styles/theme.css': ':root{}' })).toBe(true)
    expect(isThemeCssStale(base)).toBe(true)
  })
  it('is null when it cannot tell', () => {
    expect(isThemeCssStale({ 'content/design.json': design })).toBeNull()
    expect(isThemeCssStale({ 'content/brand.json': '{nope', 'content/design.json': design })).toBeNull()
  })
})

const SHA = (c: string) => c.repeat(40)
const L1 = parseTemplateMarker(null)
const L2 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.1', capabilities: ['fonts'] }))
const FOUR = { 'content/brand.json': SHA('a'), 'content/design.json': SHA('b'), 'src/styles/theme.css': SHA('c'), 'content/design-overrides.css': SHA('d') }

describe('fonts module file contract', () => {
  it('tracks the fonts module only on L2+ drafts', () => {
    expect(themeFilePaths(L1)).toEqual(THEME_FILE_PATHS)
    expect(themeFilePaths(L2)).toEqual([...THEME_FILE_PATHS, FONTS_MODULE_PATH])
  })
  it('mergeAppliedBlobs includes the fonts sha only when asked for its path', () => {
    const shas = { ...FOUR, [FONTS_MODULE_PATH]: SHA('e') }
    expect(mergeAppliedBlobs(shas, {})).toEqual(FOUR)
    expect(mergeAppliedBlobs(shas, { [FONTS_MODULE_PATH]: SHA('f') }, themeFilePaths(L2))).toEqual({ ...FOUR, [FONTS_MODULE_PATH]: SHA('f') })
  })
  it('a pre-P6a version (no fonts sha) is not drifted by the fonts module', () => {
    const current = { ...FOUR, [FONTS_MODULE_PATH]: SHA('e') }
    expect(computeDrift(current, { versionNo: 3, appliedBlobs: FOUR }, themeFilePaths(L2)).status).toBe('in-sync')
  })
  it('a version that recorded the fonts sha detects a changed module', () => {
    const current = { ...FOUR, [FONTS_MODULE_PATH]: SHA('f') }
    const latest = { versionNo: 4, appliedBlobs: { ...FOUR, [FONTS_MODULE_PATH]: SHA('e') } }
    expect(computeDrift(current, latest, themeFilePaths(L2))).toEqual({ status: 'drifted', changedPaths: [FONTS_MODULE_PATH], sinceVersion: 4 })
  })
  it('isFontsModuleStale compares the module to design.json typography', () => {
    const design = JSON.stringify({ typography: { headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' } })
    const fresh = generateFontsModule({ headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' }).source
    expect(isFontsModuleStale({ 'content/design.json': design, [FONTS_MODULE_PATH]: fresh })).toBe(false)
    expect(isFontsModuleStale({ 'content/design.json': design, [FONTS_MODULE_PATH]: 'old' })).toBe(true)
    expect(isFontsModuleStale({ 'content/design.json': design })).toBeNull()
    expect(isFontsModuleStale({ 'content/design.json': '{bad', [FONTS_MODULE_PATH]: fresh })).toBeNull()
  })
  it('a DEFAULT-kind module is stale against a design.json with typography, even when the fonts match (PF5: not yet synced)', () => {
    const design = JSON.stringify({ typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' } })
    const defaultModule = generateFontsModule().source
    expect(isFontsModuleStale({ 'content/design.json': design, [FONTS_MODULE_PATH]: defaultModule })).toBe(true)
  })
})

describe('mergeAppliedBlobs', () => {
  it('keeps only the four theme files; written shas win', () => {
    expect(mergeAppliedBlobs({ ...SNAP, 'content/other.json': D }, { 'content/brand.json': D, 'content/design-overrides.css': C })).toEqual({
      'content/brand.json': D,
      'content/design.json': B,
      'src/styles/theme.css': C,
      'content/design-overrides.css': C,
    })
  })
  it('omits files that exist in neither map', () => {
    expect(mergeAppliedBlobs({ 'content/brand.json': A }, {})).toEqual({ 'content/brand.json': A })
  })
})
