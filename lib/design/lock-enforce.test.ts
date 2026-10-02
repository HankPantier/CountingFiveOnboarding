import { describe, it, expect } from 'vitest'
import { VALID } from './__fixtures__/valid-bundle'
import { THEME_CSS_TEXT } from './__fixtures__/theme-texts'
import type { DesignBundle } from './bundle'
import { applyUserLocks, keepLockedGlobalRules, withLockPins } from './lock-enforce'
import { snapshotLook } from './lock-pins'
import type { DesignLock } from './locks'

const SNAP = snapshotLook({ themeCss: THEME_CSS_TEXT, globalCss: undefined, typography: VALID.typography, headlineStyle: 'sans' })
const AREA: DesignLock = { kind: 'area', key: 'service-cards', label: 'Service cards', snapshot: SNAP }
const lever = (key: 'palette' | 'fonts' | 'tokens' | 'treatments' | 'style' | 'layout:faq'): DesignLock => ({ kind: 'lever', key, label: key, snapshot: null })

const CURRENT: DesignBundle = {
  ...VALID,
  css: {
    global: '[data-block="service-cards"] h3 {\n  letter-spacing: 0.01em\n}\n[data-block="hero"] h1 {\n  letter-spacing: -0.02em\n}',
    blocks: { 'service-cards': '[data-block="service-cards"] .card { border-radius: var(--radius-lg) }', hero: '[data-block="hero"] h1 { letter-spacing: -0.02em; }' },
  },
}

describe('applyUserLocks — levers', () => {
  it('puts a locked palette back and leaves unlocked levers alone', () => {
    const candidate = { ...CURRENT, palette: { ...CURRENT.palette, primary: '#7a1f1f' }, tokens: { ...CURRENT.tokens, roundness: 'sharp' as const } }
    const r = applyUserLocks(candidate, CURRENT, CURRENT.css, [lever('palette')])
    expect(r.bundle.palette).toEqual(CURRENT.palette)
    expect(r.bundle.tokens.roundness).toBe('sharp')
    expect(r.notes.join(' ')).toContain('Palette is locked')
  })

  it('keeps the current fonts / treatments / style when those are locked', () => {
    const candidate: DesignBundle = {
      ...CURRENT,
      typography: { headingFont: 'Lora', bodyFont: 'Inter', accentFont: 'Lora' },
      treatments: { ...CURRENT.treatments, headlineStyle: 'sans' },
      style: { cards: 'flat' },
    }
    const r = applyUserLocks(candidate, CURRENT, CURRENT.css, [lever('fonts'), lever('treatments'), lever('style')])
    expect(r.bundle.typography).toEqual(CURRENT.typography)
    expect(r.bundle.treatments).toEqual(CURRENT.treatments)
    expect(r.bundle.style).toBeUndefined()
  })

  it('a locked preset — or one that re-lays out a locked area — is put back', () => {
    const candidate: DesignBundle = { ...CURRENT, layout: { cards: 'list', faq: 'split', team: 'list' } }
    const r = applyUserLocks(candidate, CURRENT, CURRENT.css, [AREA, lever('layout:faq')])
    expect(r.bundle.layout).toEqual({ team: 'list' })
  })
})

describe('applyUserLocks — areas', () => {
  it('a locked area keeps its own fragment and its global rules; everything else follows the candidate', () => {
    const candidate: DesignBundle = {
      ...CURRENT,
      css: {
        global: '[data-block="hero"] h1 {\n  letter-spacing: -0.04em\n}\n[data-block="service-cards"] h3 {\n  letter-spacing: 0.2em\n}',
        blocks: { 'service-cards': '[data-block="service-cards"] .card { border-radius: 0 }', hero: '[data-block="hero"] h1 { letter-spacing: -0.05em; }' },
      },
    }
    const r = applyUserLocks(candidate, CURRENT, CURRENT.css, [AREA])
    expect(r.bundle.css.blocks['service-cards']).toBe(CURRENT.css.blocks['service-cards'])
    expect(r.bundle.css.blocks.hero).toBe(candidate.css.blocks.hero)
    expect(r.bundle.css.global).toContain('letter-spacing: -0.04em')
    expect(r.bundle.css.global).toContain('letter-spacing: 0.01em')
    expect(r.bundle.css.global).not.toContain('0.2em')
    expect(r.notes.join(' ')).toContain('Locked areas keep their CSS')
  })

  it('removing a locked area’s fragment puts it back', () => {
    const candidate: DesignBundle = { ...CURRENT, css: { ...CURRENT.css, blocks: { hero: CURRENT.css.blocks.hero } } }
    const r = applyUserLocks(candidate, CURRENT, CURRENT.css, [AREA])
    expect(r.bundle.css.blocks['service-cards']).toBe(CURRENT.css.blocks['service-cards'])
  })

  it('without the current region (null) area CSS is left as the candidate has it, but pins still apply', () => {
    const candidate: DesignBundle = { ...CURRENT, css: { blocks: {} } }
    const r = applyUserLocks(candidate, CURRENT, null, [AREA])
    expect(r.bundle.css.blocks).toEqual({})
    expect(r.bundle.css.locks).toContain(':where([data-block="service-cards"])')
  })

  it('always recomputes the pins + pinned fonts, never trusting the candidate’s', () => {
    const forged: DesignBundle = { ...CURRENT, css: { ...CURRENT.css, locks: ':where([data-block="hero"]) {\n  --x: 1px;\n}' }, typography: { ...CURRENT.typography, pinnedFonts: ['Lora'] } }
    const none = applyUserLocks(forged, CURRENT, CURRENT.css, [])
    expect(none.bundle.css.locks).toBeUndefined()
    expect(none.bundle.typography.pinnedFonts).toBeUndefined()
    const one = applyUserLocks(forged, CURRENT, CURRENT.css, [AREA])
    expect(one.bundle.css.locks).toContain('service-cards')
    expect(one.bundle.css.locks).not.toContain('"hero"')
    expect(one.bundle.typography.pinnedFonts).toEqual(['Fraunces', 'Public Sans'])
  })

  it('an unchanged design comes back unchanged apart from the pins (no reordering churn)', () => {
    const r = applyUserLocks(CURRENT, CURRENT, CURRENT.css, [AREA])
    expect(r.bundle.css.global).toBe(CURRENT.css.global)
    expect(r.bundle.css.blocks).toEqual(CURRENT.css.blocks)
    expect(r.notes).toEqual([])
  })
})

describe('keepLockedGlobalRules', () => {
  it('splits a mixed selector list: only the locked selector reverts', () => {
    const current = '[data-block="service-cards"] p {\n  margin: 0\n}'
    const candidate = "[data-block='hero'] .x, [data-block=service-cards] p {\n  margin: 4px\n}"
    const out = keepLockedGlobalRules(candidate, current, ['service-cards']) ?? ''
    expect(out).toContain("[data-block='hero'] .x {")
    expect(out).toContain('margin: 4px')
    expect(out).toContain('[data-block="service-cards"] p {\n  margin: 0\n}')
  })

  it('keeps a locked rule’s @media wrapper', () => {
    const current = '@media (min-width: 600px) {\n  [data-block="service-cards"] p {\n    margin: 0\n  }\n}'
    const out = keepLockedGlobalRules(undefined, current, ['service-cards']) ?? ''
    expect(out).toMatch(/@media \(min-width: 600px\) \{[\s\S]*service-cards[\s\S]*margin: 0/)
  })
})

describe('withLockPins', () => {
  it('orders css keys canonically (global, blocks, locks)', () => {
    const b = withLockPins({ ...CURRENT, css: { blocks: CURRENT.css.blocks, global: CURRENT.css.global } }, [AREA])
    expect(Object.keys(b.css)).toEqual(['global', 'blocks', 'locks'])
  })
})
