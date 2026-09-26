import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  REGION_BEGIN,
  REGION_END,
  MANAGED_HEADER,
  MALFORMED_REGION_ERROR,
  readRegion,
  removeRegion,
  composeRegion,
  bundleFromRepoFiles,
  bundleToRepoFiles,
  hasLegacyOverrides,
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
    if (!back.ok) throw new Error('expected a well-formed region')
    expect(back.css.global).toBe(':root { --c5-gap: 4rem; }')
    expect(back.css.blocks.hero).toBe('[data-block="hero"] { color: red; }')
  })

  it('is empty when there are no fragments', () => {
    expect(composeRegion({ blocks: {} })).toBe('')
  })

  it('hasLegacyOverrides: only real CSS outside the region counts', () => {
    const region = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    expect(hasLegacyOverrides('')).toBe(false)
    expect(hasLegacyOverrides(`${MANAGED_HEADER}\n${region}`)).toBe(false)
    expect(hasLegacyOverrides(`${LEGACY}\n${region}`)).toBe(true)
    expect(hasLegacyOverrides('[data-block="hero"] h1 { color: #fff; }')).toBe(true)
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

// Fix round 1: region-marker edge cases that could silently drop hand-written
// CSS (findings task-5-findings-r1.md). RULING: exactly (1,1) begin-before-end
// is the only well-formed case; zero of each means no region; anything else
// is refused (fail closed) rather than guessed at.
describe('managed region — malformed marker hardening', () => {
  it('fails closed on a stray extra begin marker before the real region', () => {
    // Old buggy regionBounds spanned first-begin -> first-end, silently
    // swallowing the "orphaned, no matching end" text as part of the region.
    const strayBegin = `${REGION_BEGIN}\n/* orphaned, no matching end for this one */\n`
    const composed = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    const malformed = `${strayBegin}${composed}`

    expect(readRegion(malformed).ok).toBe(false)

    const r = bundleFromRepoFiles({ brandText, designText, overridesCss: malformed }, { name: 'x', source: 'baseline' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain(MALFORMED_REGION_ERROR)
  })

  it('fails closed when the file has two separate regions', () => {
    const region1 = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    const region2 = composeRegion({ blocks: { footer: '[data-component="footer"] { padding: 1rem; }' } })
    const twoRegions = `${region1}\n${region2}`

    expect(readRegion(twoRegions).ok).toBe(false)

    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: twoRegions }, { removeLegacy: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain(MALFORMED_REGION_ERROR)
  })

  it('fails closed on an orphan begin marker with no matching end', () => {
    const orphan = `${REGION_BEGIN}\n/* design-studio:hero */\n[data-block="hero"] { color: red; }\n/* /design-studio:hero */\n`
    expect(readRegion(orphan).ok).toBe(false)
    const r = bundleFromRepoFiles({ brandText, designText, overridesCss: orphan }, { name: 'x', source: 'baseline' })
    expect(r.ok).toBe(false)
  })

  it('fails closed on an orphan end marker with no matching begin', () => {
    const orphan = `/* design-studio:hero */\n[data-block="hero"] { color: red; }\n/* /design-studio:hero */\n${REGION_END}\n`
    expect(readRegion(orphan).ok).toBe(false)
    const r = bundleFromRepoFiles({ brandText, designText, overridesCss: orphan }, { name: 'x', source: 'baseline' })
    expect(r.ok).toBe(false)
  })

  it('removeLegacy:true still proceeds even when the existing overrides file is malformed', () => {
    // removeLegacy discards everything outside the region anyway, so there is
    // nothing to guess at — the malformed gate only applies when keeping legacy CSS.
    const malformed = `${REGION_BEGIN}\n${REGION_BEGIN}\nstray\n${REGION_END}\n`
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: malformed }, { removeLegacy: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.files.overridesCss.startsWith(MANAGED_HEADER.trimEnd())).toBe(true)
  })

  it('normalizes CRLF before parsing so a CRLF-saved overrides file still reads back (read path)', () => {
    const region = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    const crlf = region.replace(/\n/g, '\r\n')
    const r = readRegion(crlf)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.css.blocks.hero).toBe('[data-block="hero"] { color: red; }')
  })

  it('normalizes CRLF in the existing overrides file on the write path too', () => {
    const crlfLegacy = LEGACY.replace(/\n/g, '\r\n')
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: crlfLegacy }, { removeLegacy: false })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect(r.files.overridesCss).not.toContain('\r')
    expect(r.files.overridesCss).toContain('theme-editor:hero')
  })

  it('returns the sanitized canonical css, and reading it back yields the same css', () => {
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    const back = bundleFromRepoFiles(
      { brandText: r.files.brandText, designText: r.files.designText, overridesCss: r.files.overridesCss },
      { name: 'x', source: 'baseline' }
    )
    if (!back.ok) throw new Error(back.errors.join(' | '))
    expect(back.bundle.css).toEqual(r.css)
  })

  it('collapses to at most one blank line when removing a region from the middle of the file', () => {
    const before = '/* before */\nhtml { color: black; }'
    const after = 'html { color: white; }\n/* after */\n'
    const region = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    const css = `${before}\n\n\n${region}\n\n\n${after}`

    const result = removeRegion(css)
    expect(result).not.toMatch(/\n{3,}/)
    expect(result).toBe(`${before}\n\n${after}`.trimEnd())
  })
})
