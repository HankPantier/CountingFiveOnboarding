import { describe, expect, it } from 'vitest'
import { getPhaseStatus, isCompletePalette, isDesignSystemLocked } from './brand-gate'

const PALETTE = Object.fromEntries(
  ['primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite'].map((r) => [r, { hex: '#1f3a5f', name: r }]),
)
const TOKENS = { typePairing: { id: 'inter-inter', headingFont: 'Inter', bodyFont: 'Inter', label: 'Inter' } }

describe('isDesignSystemLocked', () => {
  it('needs both a complete palette and a type pairing', () => {
    expect(isDesignSystemLocked({ palette: PALETTE, design_tokens: TOKENS })).toBe(true)
    expect(isDesignSystemLocked({ palette: null, design_tokens: TOKENS })).toBe(false)
    expect(isDesignSystemLocked({ palette: PALETTE, design_tokens: null })).toBe(false)
    expect(isDesignSystemLocked({ palette: PALETTE, design_tokens: { typePairing: { headingFont: '' } } })).toBe(false)
  })

  it('rejects a palette missing a role or carrying a non-hex value', () => {
    const { action: _a, ...missing } = PALETTE
    expect(isCompletePalette(missing)).toBe(false)
    expect(isCompletePalette({ ...PALETTE, action: { hex: 'teal', name: 'Action' } })).toBe(false)
    expect(isCompletePalette([])).toBe(false)
  })

  it('accepts #rgb, #rrggbb and #rrggbbaa only', () => {
    const withAction = (hex: string) => isCompletePalette({ ...PALETTE, action: { hex, name: 'Action' } })
    for (const ok of ['#abc', '#aabbcc', '#aabbccdd']) expect(withAction(ok)).toBe(true)
    for (const bad of ['#abcd', '#abcde', '#aabbccd', '#aabbccddee']) expect(withAction(bad)).toBe(false)
  })
})

describe('getPhaseStatus — the sitemap waits for the Design System', () => {
  it('keeps the sitemap card locked at phase 1 until the Design System is locked', () => {
    expect(getPhaseStatus(1, 2, false)).toBe('locked')
    expect(getPhaseStatus(1, 2, true)).toBe('active')
    expect(getPhaseStatus(2, 2, false)).toBe('active')
  })

  it('keeps the Design System card open on a later-phase job that never locked one', () => {
    expect(getPhaseStatus(6, 1, false)).toBe('active')
    expect(getPhaseStatus(6, 1, true)).toBe('complete')
  })

  it('keeps the normal one-step look-ahead elsewhere', () => {
    expect(getPhaseStatus(3, 4)).toBe('active')
    expect(getPhaseStatus(3, 5)).toBe('locked')
    expect(getPhaseStatus(3, 2)).toBe('complete')
  })
})
