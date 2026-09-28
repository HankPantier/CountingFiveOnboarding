import { describe, it, expect } from 'vitest'
import { parseDesignBundle } from './bundle'
import { VALID } from './__fixtures__/valid-bundle'

describe('parseDesignBundle', () => {
  it('accepts a valid bundle and lowercases hex colours', () => {
    const r = parseDesignBundle({ ...VALID, palette: { ...VALID.palette, primary: '#003B71' } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.palette.primary).toBe('#003b71')
  })

  it('fills optional narrative fields with defaults', () => {
    const { tagline: _t, rationale: _r, moves: _m, ...rest } = VALID
    const r = parseDesignBundle(rest)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.moves).toEqual([])
  })

  it.each([
    ['bad hex', { palette: { ...VALID.palette, action: 'teal' } }, 'palette.action'],
    ['uncurated font', { typography: { ...VALID.typography, headingFont: 'Comic Sans MS' } }, 'typography.headingFont'],
    ['bad length', { tokens: { ...VALID.tokens, spacing: { ...VALID.tokens.spacing, md: '16 px; color:red' } } }, 'tokens.spacing.md'],
    ['bad enum', { tokens: { ...VALID.tokens, roundness: 'round' } }, 'tokens.roundness'],
    ['unknown css target', { css: { blocks: { sidebar: 'x' } } }, 'css.blocks'],
    ['wrong schemaVersion', { schemaVersion: 2 }, 'schemaVersion'],
  ])('rejects %s', (_n, patch, path) => {
    const r = parseDesignBundle({ ...VALID, ...patch })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain(path)
  })
})

describe('parseDesignBundle — style axes (P6b)', () => {
  it('canonicalizes style: default axes dropped', () => {
    const r = parseDesignBundle({ ...VALID, style: { cards: 'flat', nav: 'default' } })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect(r.bundle.style).toEqual({ cards: 'flat' })
  })
  it('an all-default style becomes undefined', () => {
    const r = parseDesignBundle({ ...VALID, style: { cards: 'default' } })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect(r.bundle.style).toBeUndefined()
    expect('style' in r.bundle).toBe(false)
  })
  it('rejects an unknown axis value', () => {
    expect(parseDesignBundle({ ...VALID, style: { cards: 'wobbly' } }).ok).toBe(false)
  })
})

describe('parseDesignBundle — layout presets (2026.09.9)', () => {
  it('old versions without layout still parse, with no layout key', () => {
    const r = parseDesignBundle(VALID)
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect('layout' in r.bundle).toBe(false)
  })
  it('canonicalizes layout: default presets dropped, all-default → absent', () => {
    const r = parseDesignBundle({ ...VALID, layout: { cards: 'list', faq: 'default' } })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect(r.bundle.layout).toEqual({ cards: 'list' })
    const d = parseDesignBundle({ ...VALID, layout: { faq: 'default' } })
    expect(d.ok && 'layout' in d.bundle).toBe(false)
  })
  it('rejects an unknown preset or value', () => {
    expect(parseDesignBundle({ ...VALID, layout: { cards: 'grid' } }).ok).toBe(false)
    expect(parseDesignBundle({ ...VALID, layout: { hero: 'split' } }).ok).toBe(false)
  })
})
