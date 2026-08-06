import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { generateThemeCss, checkThemeContrast } from './theme-css-generator'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

// The golden fixture is the ACTUAL output of the template's
// scripts/generate-theme.ts (counting-five-client-template) for the fixture
// brand.json + design.json — captured verbatim. This is the drift guard: if the
// template script changes, this test fails and both must be updated together.
const FIX = path.join(__dirname, '__fixtures__')
const golden = readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8')
const brand = JSON.parse(readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')) as BrandJson
const design = JSON.parse(readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')) as DesignJson

describe('generateThemeCss', () => {
  it('reproduces the template generate-theme.ts output byte-for-byte', () => {
    expect(generateThemeCss(brand, design)).toBe(golden)
  })

  it('reflects a palette change in the emitted --color-primary token', () => {
    const warmed: BrandJson = { ...brand, palette: { ...brand.palette, primary: '#7a1f1f' } }
    const css = generateThemeCss(warmed, design)
    expect(css).not.toBe(golden)
    // The new primary hue (a warm red) surfaces in both the literal hex token
    // and the HSL-derived --color-primary.
    expect(css).toContain('--color-primary-hex: #7a1f1f;')
  })

  it('reflects a radius change in the emitted --radius-pill token', () => {
    const rounder: DesignJson = { ...design, radius: { ...design.radius, pill: '40px' } }
    expect(generateThemeCss(brand, rounder)).toContain('--radius-pill: 40px;')
  })
})

describe('checkThemeContrast', () => {
  it('returns no failures for the fixture palette (AA-safe)', () => {
    expect(checkThemeContrast(brand)).toEqual([])
  })

  it('flags a low-contrast palette', () => {
    // near-black text on a near-black background can never clear AA.
    const bad: BrandJson = {
      ...brand,
      palette: { ...brand.palette, nearWhite: '#111111', nearBlack: '#000000' },
    }
    const failures = checkThemeContrast(bad)
    expect(failures.length).toBeGreaterThan(0)
  })
})
