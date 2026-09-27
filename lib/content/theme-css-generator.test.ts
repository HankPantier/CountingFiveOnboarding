import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import chroma from 'chroma-js'
import {
  generateThemeCss,
  checkThemeContrast,
  checkActionContrast,
  formatContrastFailure,
  ACTION_ON_PRIMARY_PAIR,
  ACTION_ON_BACKGROUND_PAIR,
} from './theme-css-generator'
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

  it('emits a brand-tinted ink section token + near-white foreground', () => {
    const css = generateThemeCss(brand, design)
    // Deep near-black derived from the fixture navy primary (#003B71).
    expect(css).toContain('--color-ink: #131c2a;')
    expect(css).toContain('--color-ink-foreground: #F7F5F2;')
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

describe('checkActionContrast — advisory action-colour pairs', () => {
  // The Task 8 concept: vermilion action on a deep-teal primary.
  const failing = { ...brand.palette, primary: '#003a42', action: '#cc381e' }

  it('flags action text on the AA-corrected primary below 4.5:1, with a fix hint', () => {
    const pair = checkActionContrast({ palette: failing }).find((f) => f.name === ACTION_ON_PRIMARY_PAIR)
    expect(pair).toMatchObject({ minRatio: 4.5, fg: '#cc381e' })
    expect(pair!.ratio).toBeCloseTo(2.47, 1)
    expect(formatContrastFailure(pair!)).toMatch(/^action \/ primary: 2\.4\d:1 \(need 4\.5:1\) — .*action colour/)
  })

  it('flags action text on the page background (nearWhite) below 4.5:1', () => {
    // bblcpa-style bright orange on white ≈ 2.29:1.
    const pair = checkActionContrast({ palette: { ...brand.palette, action: '#ff8e27', nearWhite: '#ffffff' } }).find(
      (f) => f.name === ACTION_ON_BACKGROUND_PAIR
    )
    expect(pair).toMatchObject({ minRatio: 4.5, bg: '#ffffff', fg: '#ff8e27' })
    expect(pair!.ratio).toBeCloseTo(2.29, 1)
    expect(pair!.hint).toMatch(/darker action colour/)
  })

  it('is boundary-exact at 4.5:1 on the background', () => {
    const on = (action: string) => checkActionContrast({ palette: { ...brand.palette, nearWhite: '#ffffff', action } }).some((f) => f.name === ACTION_ON_BACKGROUND_PAIR)
    expect(on('#767676')).toBe(false) // 4.54:1
    expect(on('#777777')).toBe(true) // 4.48:1
  })

  it('both pairs cannot pass together on a dark primary (why they are advisory)', () => {
    // contrast(a,primary) × contrast(a,bg) = contrast(primary,bg) ≈ 10.35 < 20.25 for navy on #f7f5f2.
    for (let l = 0; l <= 100; l += 2) {
      const hex = chroma.hsl(20, 1, l / 100).hex()
      expect(checkActionContrast({ palette: { ...brand.palette, action: hex } }).length).toBeGreaterThan(0)
    }
  })

  it('never appears in the hard gate — checkThemeContrast is the pre-2026-09-26 set', () => {
    expect(checkThemeContrast({ palette: failing }).map((f) => f.name)).not.toContain(ACTION_ON_PRIMARY_PAIR)
    expect(checkThemeContrast({ palette: { ...brand.palette, action: '#ff8e27' } })).toEqual([])
    expect(checkThemeContrast(brand).map((f) => f.name)).toEqual([])
  })


  it('formats failures without a hint exactly as before', () => {
    expect(formatContrastFailure({ name: 'ink-fg / ink', ratio: 3.2, minRatio: 4.5, bg: '#000', fg: '#111' })).toBe('ink-fg / ink: 3.20:1 (need 4.5:1)')
  })
})
