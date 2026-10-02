import { describe, it, expect } from 'vitest'
import { VALID } from './__fixtures__/valid-bundle'
import { controlsLockViolations, controlsLockedError, defaultLockLabel, isLeverKey, lockedPresets, withoutLockPins } from './locks'

describe('design lock vocabulary', () => {
  it('knows its levers, including one per layout preset', () => {
    expect(isLeverKey('palette')).toBe(true)
    expect(isLeverKey('layout:cards')).toBe(true)
    expect(isLeverKey('layout:nope')).toBe(false)
    expect(defaultLockLabel('area', 'service-cards')).toBe('Service cards')
    expect(defaultLockLabel('lever', 'layout:ctaBanner')).toBe('CTA banner layout')
  })

  it('a preset is locked by its own lever or by a locked block it re-lays out', () => {
    expect(lockedPresets([{ kind: 'area', key: 'feature-grid' }])).toEqual(['cards'])
    expect(lockedPresets([{ kind: 'lever', key: 'layout:faq' }, { kind: 'area', key: 'team-grid' }])).toEqual(['faq', 'team'])
    expect(lockedPresets([{ kind: 'area', key: 'hero' }])).toEqual([])
  })
})

describe('controlsLockViolations (theme PATCH)', () => {
  const locks = [
    { kind: 'lever', key: 'palette', label: 'Palette' },
    { kind: 'area', key: 'testimonials', label: 'Testimonials' },
  ]
  const none = { palette: false, fonts: false, treatments: false, layoutBefore: undefined, layoutAfter: undefined }

  it('names the locks a picker change would break', () => {
    expect(controlsLockViolations(locks, { ...none, palette: true })).toEqual(['Palette'])
    expect(controlsLockViolations(locks, { ...none, layoutBefore: {}, layoutAfter: { testimonials: 'featured' } })).toEqual(['Testimonials layout'])
    expect(controlsLockedError(['Palette'])).toBe('Palette is locked in the design chat — unlock it there (or with the lock chip) first.')
  })

  it('lets changes to unlocked levers through', () => {
    expect(controlsLockViolations(locks, { ...none, fonts: true, treatments: true, layoutBefore: {}, layoutAfter: { faq: 'split' } })).toEqual([])
  })
})

describe('withoutLockPins', () => {
  it('hides the platform pins from a model', () => {
    const b = withoutLockPins({ ...VALID, css: { ...VALID.css, locks: ':where([data-block="hero"]) {\n  --x: 1px;\n}' }, typography: { ...VALID.typography, pinnedFonts: ['Lora'] } })
    expect(b.css.locks).toBeUndefined()
    expect(b.typography.pinnedFonts).toBeUndefined()
  })
})
