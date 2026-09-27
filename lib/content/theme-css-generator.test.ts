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
  deriveLightActionTextTokens,
  ensureTextContrast,
  hslTokensToHex,
  renderedHex,
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

describe('checkActionContrast — advisory LARGE-text action pairs (3:1)', () => {
  // The Task 8 concept: vermilion action on a deep-teal primary.
  const failing = { ...brand.palette, primary: '#003a42', action: '#cc381e' }

  it('flags raw action as large text on the AA-corrected primary below 3:1, with a fix hint', () => {
    const pair = checkActionContrast({ palette: failing }).find((f) => f.name === ACTION_ON_PRIMARY_PAIR)
    expect(pair).toMatchObject({ minRatio: 3, fg: '#cc381e' })
    expect(pair!.ratio).toBeCloseTo(2.47, 1)
    expect(formatContrastFailure(pair!)).toMatch(/^action \(large text\) \/ primary: 2\.4\d:1 \(need 3:1\) — .*large display text/)
  })

  it('flags raw action as large text on the page background below 3:1', () => {
    // bblcpa-style bright orange on white ≈ 2.29:1 — still a large-accent warning.
    const pair = checkActionContrast({ palette: { ...brand.palette, action: '#ff8e27', nearWhite: '#ffffff' } }).find(
      (f) => f.name === ACTION_ON_BACKGROUND_PAIR
    )
    expect(pair).toMatchObject({ minRatio: 3, bg: '#ffffff', fg: '#ff8e27' })
    expect(pair!.ratio).toBeCloseTo(2.29, 1)
    expect(pair!.hint).toMatch(/headline accent/)
  })

  it('is boundary-exact at 3:1 on the background', () => {
    const on = (action: string) => checkActionContrast({ palette: { ...brand.palette, nearWhite: '#ffffff', action } }).some((f) => f.name === ACTION_ON_BACKGROUND_PAIR)
    expect(on('#949494')).toBe(false) // 3.03:1
    expect(on('#959595')).toBe(true) // 2.99:1
  })

  it('no longer warns in the 3:1–4.5:1 band (small text there is auto-corrected)', () => {
    // #00C1DE on navy = 5.19, on #F7F5F2 = 1.99 → only the background pair.
    expect(checkActionContrast(brand).map((f) => f.name)).toEqual([ACTION_ON_BACKGROUND_PAIR])
    // A mid orange at ~3.2:1 on both surfaces of the navy fixture: no warning.
    expect(checkActionContrast({ palette: { ...brand.palette, action: '#f45100' } })).toEqual([])
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

const tokenValues = (css: string, name: string) => [...css.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1])
const hueDelta = (a: string, b: string) => {
  const d = Math.abs(chroma(a).oklch()[2] - chroma(b).oklch()[2]) % 360
  return Math.min(d, 360 - d)
}
const cssBlock = (css: string, which: 'root' | 'dark') =>
  which === 'root' ? css.slice(css.indexOf(':root {'), css.indexOf('.dark {')) : css.slice(css.indexOf('.dark {'))
const tok = (blk: string, name: string) => blk.match(new RegExp(`\\n\\s*${name}: ([^;]+);`))![1]

type TableRow = {
  name: string
  palette: BrandJson['palette']
  light: { actionText: string; actionTextCanvas: string; actionTextTint: string; actionOnPrimary: string; actionOnInk: string }
  dark: { actionText: string; actionTextCanvas: string; actionTextTint: string }
}
// Byte-identical copy of the template's src/lib/theme/__fixtures__/action-text-table.json
// (captured from generate-theme.ts) — pins parity beyond the one golden.
const TABLE = JSON.parse(readFileSync(path.join(FIX, 'action-text-table.json'), 'utf-8')) as TableRow[]

describe('small-text action tokens', () => {
  it('golden: house default tokens', () => {
    expect(tokenValues(golden, '--color-action-text')).toEqual(['#007a8d', '#007a8d', '#00C1DE'])
    expect(tokenValues(golden, '--color-action-on-primary')).toEqual(['#00C1DE', '#00C1DE'])
    expect(tokenValues(golden, '--color-action-on-ink')).toEqual(['#00C1DE', '#00C1DE'])
  })

  it.each(TABLE.map((r) => [r.name, r] as const))('palette→token table (shared with the template): %s', (_, row) => {
    const css = generateThemeCss({ palette: row.palette }, design)
    const r = cssBlock(css, 'root')
    const d = cssBlock(css, 'dark')
    expect({
      actionText: tok(r, '--color-action-text'),
      actionTextCanvas: tok(r, '--color-action-text-canvas'),
      actionTextTint: tok(r, '--color-action-text-tint'),
      actionOnPrimary: tok(r, '--color-action-on-primary'),
      actionOnInk: tok(r, '--color-action-on-ink'),
    }).toEqual(row.light)
    expect({
      actionText: tok(d, '--color-action-text'),
      actionTextCanvas: tok(d, '--color-action-text-canvas'),
      actionTextTint: tok(d, '--color-action-text-tint'),
    }).toEqual(row.dark)
    // ≥4.5 on what the browser paints (the hsl() lines), light and dark.
    for (const sName of ['--color-background', '--color-muted', '--color-card']) {
      expect(chroma.contrast(row.light.actionText, hslTokensToHex(tok(r, sName))), sName).toBeGreaterThanOrEqual(4.5)
      expect(chroma.contrast(row.dark.actionText, hslTokensToHex(tok(d, sName))), `.dark ${sName}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(chroma.contrast(row.light.actionOnPrimary, hslTokensToHex(tok(r, '--color-primary')))).toBeGreaterThanOrEqual(4.5)
    expect(chroma.contrast(row.light.actionOnInk, tok(r, '--color-ink'))).toBeGreaterThanOrEqual(4.5)
  })

  it('Accord: on-primary clears the RENDERED primary #1f3a60 (hex #1F3A5F)', () => {
    expect(renderedHex('#1F3A5F')).toBe('#1f3a60')
    const accord = TABLE.find((r) => r.name === 'accord-advisors')!
    expect(chroma.contrast(accord.light.actionOnPrimary, '#1f3a60')).toBeGreaterThanOrEqual(4.5)
  })

  it('returns an already-passing colour EXACTLY and is boundary-exact', () => {
    expect(ensureTextContrast('#00C1DE', '#003B71')).toBe('#00C1DE')
    const exact = chroma.contrast('#777777', '#ffffff')
    expect(ensureTextContrast('#777777', '#ffffff', exact)).toBe('#777777')
    expect(ensureTextContrast('#777777', '#ffffff', exact + 0.001)).not.toBe('#777777')
  })

  it('hue scan on the rendered navy fixture: both tokens pass, hue held', () => {
    const s = { background: renderedHex(brand.palette.nearWhite), muted: renderedHex(chroma(brand.palette.nearWhite).set('hsl.l', 0.95).hex()), card: renderedHex(brand.palette.nearWhite), primary: renderedHex(brand.palette.primary), ink: '#131c2a' }
    for (let h = 0; h < 360; h += 10) {
      const action = chroma.oklch(0.75, 0.14, h).hex()
      const t = deriveLightActionTextTokens(action, s)
      expect(chroma.contrast(t.actionText, s.muted), `h=${h}`).toBeGreaterThanOrEqual(4.5)
      expect(chroma.contrast(t.actionOnPrimary, s.primary), `h=${h}`).toBeGreaterThanOrEqual(4.5)
      if (t.actionText !== action) expect(hueDelta(t.actionText, action), `h=${h}`).toBeLessThan(4)
    }
  })

  it('R1: an action that passes canvas + primary is emitted verbatim for on-primary', () => {
    const css = generateThemeCss(
      { palette: { ...brand.palette, action: '#C45300', primary: '#000000', nearWhite: '#FFFFFF', nearBlack: '#000000' } },
      design
    )
    expect(tokenValues(css, '--color-action-on-primary')).toEqual(['#C45300', '#C45300'])
  })

  it('never throws on a bad colour', () => {
    expect(ensureTextContrast('nope', '#ffffff')).toBe('nope')
  })
})
