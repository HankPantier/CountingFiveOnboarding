import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  REGION_BEGIN,
  REGION_END,
  MANAGED_HEADER,
  readRegion,
  removeRegion,
  composeRegion,
  bundleFromRepoFiles,
  bundleToRepoFiles,
} from './bundle-files'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { VALID } from './__fixtures__/valid-bundle'

const FIX = path.join(__dirname, '..', 'content', '__fixtures__')
const brandText = readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')
const designText = readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')
const LEGACY = '/* theme-editor:hero */\n[data-block="hero"] { color: red; }\n/* /theme-editor:hero */\n'

describe('managed region', () => {
  it('composes and reads back fragments in stable order', () => {
    const region = composeRegion({ global: ':root { --c5-gap: 4rem; }', blocks: { footer: '[data-component="footer"] { padding: 2rem; }', hero: '[data-block="hero"] { color: red; }' } })
    expect(region.startsWith(REGION_BEGIN)).toBe(true)
    expect(region.trimEnd().endsWith(REGION_END)).toBe(true)
    expect(region.indexOf('design-studio:global')).toBeLessThan(region.indexOf('design-studio:hero'))
    expect(region.indexOf('design-studio:hero')).toBeLessThan(region.indexOf('design-studio:footer'))
    const back = readRegion(`${LEGACY}\n${region}`)
    expect(back.global).toBe(':root { --c5-gap: 4rem; }')
    expect(back.blocks.hero).toBe('[data-block="hero"] { color: red; }')
  })

  it('is empty when there are no fragments', () => {
    expect(composeRegion({ blocks: {} })).toBe('')
  })

  it('removeRegion keeps everything outside the region', () => {
    const region = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    expect(removeRegion(`${LEGACY}\n${region}`)).toBe(LEGACY.trimEnd())
  })
})

describe('bundleFromRepoFiles', () => {
  it('builds a baseline bundle from the golden fixtures', () => {
    const r = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current site', source: 'baseline' })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect(r.bundle.palette.primary).toBe(JSON.parse(brandText).palette.primary.toLowerCase())
    expect(r.bundle.typography.accentFont).toBe('Fraunces') // normalized: golden lacks accentFont
    expect(r.bundle.treatments).toEqual({ headlineStyle: 'sans', eyebrowStyle: 'standard', darkSections: false })
    expect(r.bundle.css.blocks).toEqual({})
  })
})

describe('bundleToRepoFiles', () => {
  it('round-trips the baseline: palette unchanged and theme.css regenerated from the output', () => {
    const base = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current site', source: 'baseline' })
    if (!base.ok) throw new Error('baseline failed')
    const r = bundleToRepoFiles(base.bundle, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    // The golden fixture's hexes are uppercase; the bundle normalizes to lowercase.
    const golden = JSON.parse(brandText)
    const lowered = Object.fromEntries(Object.entries(golden.palette).map(([k, v]) => [k, String(v).toLowerCase()]))
    expect(JSON.parse(r.files.brandText)).toEqual({ ...golden, palette: lowered })
    expect(r.files.brandText.endsWith('}\n')).toBe(true)
    expect(r.files.themeCss).toBe(generateThemeCss(JSON.parse(r.files.brandText), JSON.parse(r.files.designText)))
    expect(r.files.overridesCss).toBe('')
  })

  it('applies palette, fonts, tokens, treatments and derives googleFontsUrl', () => {
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    const brand = JSON.parse(r.files.brandText)
    const design = JSON.parse(r.files.designText)
    expect(brand.palette.action).toBe('#00c1de')
    expect(brand.firm).toEqual(JSON.parse(brandText).firm) // non-palette fields untouched
    expect(design.typography.accentFont).toBe('Fraunces')
    expect(design.typography.googleFontsUrl).toContain('family=Public+Sans')
    expect(design.visualFeel).toBe('editorial')
    expect(design.headlineStyle).toBe('serif')
    expect(design.darkSections).toBe(true)
    expect(r.files.overridesCss).toContain('design-studio:hero')
  })

  it('omits default treatments from design.json', () => {
    const b = { ...VALID, treatments: { headlineStyle: 'sans' as const, eyebrowStyle: 'standard' as const, darkSections: false } }
    const r = bundleToRepoFiles(b, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error('failed')
    const design = JSON.parse(r.files.designText)
    expect('headlineStyle' in design).toBe(false)
    expect('darkSections' in design).toBe(false)
  })

  it('keeps legacy CSS by default and replaces only the region', () => {
    const old = `${LEGACY}\n${composeRegion({ blocks: { hero: '[data-block="hero"] { color: blue; }' } })}`
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: old }, { removeLegacy: false })
    if (!r.ok) throw new Error('failed')
    expect(r.files.overridesCss).toContain('theme-editor:hero')
    expect(r.files.overridesCss).not.toContain('color: blue')
    expect(r.files.overridesCss.match(/design-studio:begin/g)).toHaveLength(1)
  })

  it('removeLegacy drops everything outside the region and writes the managed header', () => {
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: LEGACY }, { removeLegacy: true })
    if (!r.ok) throw new Error('failed')
    expect(r.files.overridesCss.startsWith(MANAGED_HEADER.trimEnd())).toBe(true)
    expect(r.files.overridesCss).not.toContain('theme-editor')
  })

  it('rejects a bundle whose CSS fails the sanitizer, naming the fragment', () => {
    const bad = { ...VALID, css: { blocks: { hero: 'body { display: none; }' } } }
    const r = bundleToRepoFiles(bad, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('css.blocks.hero')
  })

  it('rejects invalid brand.json text', () => {
    const r = bundleToRepoFiles(VALID, { brandText: '{nope', designText, overridesCss: '' }, { removeLegacy: false })
    expect(r.ok).toBe(false)
  })
})
