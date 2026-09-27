import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { generateThemeCss, checkThemeContrast, formatContrastFailure, ACTION_ON_PRIMARY_PAIR } from './theme-css-generator'
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

describe('checkThemeContrast — action / primary (2026-09-26)', () => {
  // The Task 8 concept: vermilion action on a deep-teal primary (2.46:1). The
  // page-header kicker (12px/600) is action-on-primary small text ⇒ 4.5:1.
  const failing = { ...brand.palette, primary: '#003a42', action: '#cc381e' }
  const fixture = brand.palette // #00C1DE on #003B71 ≈ 5.19:1

  it('flags action text on the primary surface below 4.5:1, with a fix hint', () => {
    const failures = checkThemeContrast({ palette: failing })
    const pair = failures.find((f) => f.name === ACTION_ON_PRIMARY_PAIR)
    expect(pair).toMatchObject({ minRatio: 4.5, fg: '#cc381e' })
    expect(pair!.ratio).toBeCloseTo(2.47, 1)
    expect(pair!.hint).toMatch(/action colour/)
    expect(formatContrastFailure(pair!)).toMatch(/^action \/ primary: 2\.4\d:1 \(need 4\.5:1\) — /)
  })

  it('passes the fixture palette and checks against the AA-corrected primary surface', () => {
    expect(checkThemeContrast({ palette: fixture }).find((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBeUndefined()
  })

  it('is boundary-exact at 4.5:1', () => {
    // #767676 on white is the canonical 4.54:1; on primary white (AA-picked fg ⇒ primary kept) it passes.
    const pass = { ...brand.palette, primary: '#ffffff', nearBlack: '#000000', nearWhite: '#ffffff', action: '#767676' }
    const fail = { ...pass, action: '#777777' } // 4.48:1
    expect(checkThemeContrast({ palette: pass }).some((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBe(false)
    expect(checkThemeContrast({ palette: fail }).some((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBe(true)
  })

  it('is grandfathered when the baseline palette already has the same action + primary (case-insensitive)', () => {
    const baseline = { ...failing, primary: '#003A42', action: '#CC381E', secondary: '#123456' }
    expect(checkThemeContrast({ palette: failing }, { baseline }).some((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBe(false)
  })

  it('is NOT grandfathered once either colour changes — a new failing pair is still caught', () => {
    const baseline = { ...failing, action: '#00c1de' }
    expect(checkThemeContrast({ palette: failing }, { baseline }).some((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBe(true)
  })

  it('grandfathers any listed recorded pair (a restore of an earlier palette), case-insensitively', () => {
    const grandfathered = [{ action: '#00c1de', primary: '#003b71' }, { action: '#CC381E', primary: '#003A42' }]
    expect(checkThemeContrast({ palette: failing }, { baseline: fixture, grandfathered }).some((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBe(false)
    expect(checkThemeContrast({ palette: failing }, { baseline: fixture, grandfathered: [grandfathered[0]] }).some((f) => f.name === ACTION_ON_PRIMARY_PAIR)).toBe(true)
  })

  it('never grandfathers the pre-existing pairs', () => {
    const bad = { ...brand.palette, nearWhite: '#111111', nearBlack: '#000000' }
    expect(checkThemeContrast({ palette: bad }, { baseline: bad }).length).toBeGreaterThan(0)
  })

  it('formats failures without a hint exactly as before', () => {
    expect(formatContrastFailure({ name: 'ink-fg / ink', ratio: 3.2, minRatio: 4.5, bg: '#000', fg: '#111' })).toBe('ink-fg / ink: 3.20:1 (need 4.5:1)')
  })
})
