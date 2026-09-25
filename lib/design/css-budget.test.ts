import { describe, it, expect } from 'vitest'
import { countCssLines, cssByteLength, isCssSizeCapError, MAX_TARGET_BYTES, MAX_TARGET_LINES } from './css-budget'
import { sanitizeDesignCss } from './css-sanitizer'

const rule = '[data-block="hero"] h1 { margin: 0 }'

describe('css-budget', () => {
  it('counts lines on the trimmed text and bytes in UTF-8', () => {
    expect(countCssLines('\n a\nb \n')).toBe(2)
    expect(cssByteLength(' é ')).toBe(2)
  })
  it('the sanitizer’s line count is countCssLines of its (reformatted) output', () => {
    const r = sanitizeDesignCss(rule, { kind: 'target', target: 'hero' })
    expect(r.ok && countCssLines(r.css)).toBe(3)
    const over = sanitizeDesignCss(Array.from({ length: 21 }, () => rule).join('\n'), { kind: 'target', target: 'hero' })
    expect(over).toEqual({ ok: false, errors: [`The CSS has 63 lines (max ${MAX_TARGET_LINES}).`] })
  })
  it('recognizes size-cap errors (prefixed or not) and nothing else', () => {
    const big = sanitizeDesignCss(`${rule}\n`.repeat(200), { kind: 'target', target: 'hero' })
    expect(big).toEqual({ ok: false, errors: [`The CSS is too large (max ${MAX_TARGET_BYTES} bytes).`] })
    expect(isCssSizeCapError('css.blocks.hero: The CSS has 91 lines (max 60).')).toBe(true)
    expect(isCssSizeCapError('css.global: The CSS is too large (max 16000 bytes).')).toBe(true)
    expect(isCssSizeCapError('The CSS has 63 lines (max 60).')).toBe(true)
    expect(isCssSizeCapError('css.blocks.hero: Too many !important declarations (6; max 5).')).toBe(false)
    expect(isCssSizeCapError('after repair: css.blocks.hero: The CSS has 91 lines (max 60).')).toBe(false)
    expect(isCssSizeCapError('palette.primary: invalid')).toBe(false)
  })
})
