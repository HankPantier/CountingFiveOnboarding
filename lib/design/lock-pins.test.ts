import { describe, it, expect } from 'vitest'
import { THEME_CSS_TEXT } from './__fixtures__/theme-texts'
import { composeLockPins, isWellFormedLockPins, parseLockSnapshot, pinnedFontsOf, snapshotLook, TEMPLATE_SCALE_DEFAULTS } from './lock-pins'
import type { DesignLock, LockSnapshot } from './locks'

const TYPO = { headingFont: 'Lora', bodyFont: 'Inter', accentFont: 'Fraunces' }
const snap = (over: Partial<Parameters<typeof snapshotLook>[0]> = {}): LockSnapshot =>
  snapshotLook({ themeCss: THEME_CSS_TEXT, globalCss: undefined, typography: TYPO, headlineStyle: 'sans', ...over })

describe('snapshotLook', () => {
  it('captures theme.css colours, spacing, radius and shadows from @theme + :root, and the dark overrides', () => {
    const s = snap()
    expect(s.vars['--color-primary']).toBe('hsl(209 100% 22%)')
    expect(s.vars['--color-action-text']).toBe('#007a8d')
    expect(s.vars['--c5-space-md']).toBe('16px')
    expect(s.vars['--radius-lg']).toBe('16px')
    expect(s.vars['--shadow-card']).toBe('0 2px 8px rgba(0, 59, 113, 0.08)')
    expect(s.darkVars['--color-background']).toBe('hsl(210 9% 9%)')
  })

  it('never copies the font roles (they are re-declared from the families)', () => {
    const s = snap()
    expect(s.vars['--font-heading']).toBeUndefined()
    expect(s.vars['--font-body']).toBeUndefined()
    expect(s.fonts).toEqual({ heading: 'Lora', body: 'Inter', accent: 'Fraunces', display: 'heading' })
  })

  it('carries the template type-scale defaults, overridden by the global fragment’s :root properties', () => {
    const s = snap({ globalCss: ':root {\n  --type-h2: 2.5rem;\n}\n[data-block="hero"] h1 { color: var(--color-primary) }' })
    expect(s.vars['--type-h3']).toBe(TEMPLATE_SCALE_DEFAULTS['--type-h3'])
    expect(s.vars['--type-h2']).toBe('2.5rem')
  })

  it('serif headlines pin the display role to the accent family', () => {
    expect(snap({ headlineStyle: 'serif' }).fonts.display).toBe('accent')
  })
})

describe('composeLockPins', () => {
  const area = (key: 'service-cards' | 'navbar', s: LockSnapshot = snap()): DesignLock => ({ kind: 'area', key, label: key, snapshot: s })

  it('is empty without area locks (levers pin nothing)', () => {
    expect(composeLockPins([{ kind: 'lever', key: 'palette', label: 'Palette', snapshot: null }])).toBe('')
  })

  it('writes zero-specificity :where() rules per locked target, light then dark, in a stable order', () => {
    const css = composeLockPins([area('service-cards'), area('navbar')])
    const rules = css.split('\n').filter((l) => l.startsWith(':where('))
    expect(rules).toEqual([
      ':where([data-component="navbar"]) {',
      ':where(.dark [data-component="navbar"]) {',
      ':where([data-block="service-cards"]) {',
      ':where(.dark [data-block="service-cards"]) {',
    ])
    expect(css).toContain('  --color-primary: hsl(209 100% 22%);')
    expect(css).toContain('  --font-heading: var(--font-pin-lora, "Lora"), system-ui, sans-serif;')
    expect(css).toContain('  --font-accent: var(--font-pin-fraunces, "Fraunces"), Georgia, "Times New Roman", serif;')
    expect(css).toContain('  --font-display: var(--font-pin-lora, "Lora"), system-ui, sans-serif;')
    expect(isWellFormedLockPins(css)).toBe(true)
  })

  it('drops unsafe values instead of writing them', () => {
    const s = snap()
    const css = composeLockPins([area('service-cards', { ...s, vars: { ...s.vars, '--color-primary': 'red; } body { display:none' } })])
    expect(css).not.toContain('display:none')
    expect(isWellFormedLockPins(css)).toBe(true)
  })

  it('lists every pinned family once, sorted', () => {
    expect(pinnedFontsOf([area('service-cards'), area('navbar')])).toEqual(['Fraunces', 'Inter', 'Lora'])
  })
})

describe('isWellFormedLockPins', () => {
  it('accepts empty and refuses anything but custom-property :where() rules', () => {
    expect(isWellFormedLockPins('')).toBe(true)
    expect(isWellFormedLockPins(':where([data-block="hero"]) {\n  color: red;\n}')).toBe(false)
    expect(isWellFormedLockPins('[data-block="hero"] {\n  --x: 1px;\n}')).toBe(false)
    expect(isWellFormedLockPins(':where([data-block="hero"]) {\n  --x: 1px;\n')).toBe(false)
    expect(isWellFormedLockPins('@import url(x);')).toBe(false)
  })
})

describe('parseLockSnapshot', () => {
  it('round-trips a snapshot and rejects garbage', () => {
    const s = snap()
    expect(parseLockSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
    expect(parseLockSnapshot(null)).toBeNull()
    expect(parseLockSnapshot({ vars: {}, darkVars: {}, fonts: { heading: 1 } })).toBeNull()
  })
})

describe('missing font families', () => {
  it('skips a family the snapshot lacks instead of throwing', () => {
    const s = snapshotLook({ themeCss: THEME_CSS_TEXT, globalCss: undefined, typography: { headingFont: 'Lora', bodyFont: 'Inter', accentFont: undefined as unknown as string }, headlineStyle: 'serif' })
    const css = composeLockPins([{ kind: 'area', key: 'hero', label: 'Hero', snapshot: s }])
    expect(css).not.toContain('--font-accent')
    expect(css).not.toContain('--font-display')
    expect(pinnedFontsOf([{ kind: 'area', key: 'hero', label: 'Hero', snapshot: s }])).toEqual(['Inter', 'Lora'])
    expect(isWellFormedLockPins(css)).toBe(true)
  })
})
