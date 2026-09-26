import { describe, it, expect } from 'vitest'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { VALID } from './__fixtures__/valid-bundle'
import {
  capabilitiesFromJson,
  capabilityLevel,
  capabilityViolations,
  enforceCapabilities,
  fontsUnlocked,
  intersectWithShell,
  parseTemplateMarker,
  specimenUnlocked,
  styleAxesUnlocked,
} from './capabilities'
import { DEFAULT_CAPABILITIES } from './run-types'

const OTHER_FONT = CURATED_FONTS.find((f) => f !== 'Public Sans' && f !== 'Fraunces') as string
const L2 = parseTemplateMarker(JSON.stringify({ templateVersion: '2.0.0', capabilities: ['fonts'] }))

describe('parseTemplateMarker', () => {
  it('defaults to L1 when the marker is absent', () => {
    expect(parseTemplateMarker(null)).toEqual(DEFAULT_CAPABILITIES)
  })
  it.each(['not json', '[]', '"x"', 'null'])('defaults to L1 for a malformed marker (%s)', (text) => {
    expect(parseTemplateMarker(text)).toEqual(DEFAULT_CAPABILITIES)
  })
  it.each([
    [[], 1],
    [['fonts'], 2],
    [['fonts', 'style-axes'], 3],
    [['fonts', 'style-axes', 'specimen'], 4],
    [['style-axes'], 1],
    [['fonts', 'specimen'], 2],
  ] as const)('derives the tier from %j → L%i', (caps, level) => {
    const c = parseTemplateMarker(JSON.stringify({ templateVersion: '1.4.0', capabilities: caps }))
    expect(c.level).toBe(level)
    expect(c.source).toBe('marker')
    expect(c.templateVersion).toBe('1.4.0')
  })
  it('ignores non-string capability entries', () => {
    const c = parseTemplateMarker(JSON.stringify({ capabilities: ['fonts', 7, null] }))
    expect(c.capabilities).toEqual(['fonts'])
    expect(c.templateVersion).toBeNull()
  })
  it('unlocks fonts at L2 and style axes at L3', () => {
    expect(fontsUnlocked(DEFAULT_CAPABILITIES)).toBe(false)
    expect(fontsUnlocked(L2)).toBe(true)
    expect(styleAxesUnlocked(L2)).toBe(false)
    expect(styleAxesUnlocked(parseTemplateMarker(JSON.stringify({ capabilities: ['fonts', 'style-axes'] })))).toBe(true)
  })
})

describe('capabilitiesFromJson', () => {
  it('round-trips a stored snapshot', () => {
    expect(capabilitiesFromJson(JSON.parse(JSON.stringify(L2)))).toEqual(L2)
  })
  it.each([null, 'x', { level: 9 }, { level: 2, source: 'hacker' }])('falls back to L1 for %j', (v) => {
    expect(capabilitiesFromJson(v)).toEqual(DEFAULT_CAPABILITIES)
  })
})

describe('font lock', () => {
  const changedFonts = { ...VALID, typography: { headingFont: OTHER_FONT, bodyFont: OTHER_FONT, accentFont: 'Fraunces' } }

  it('below L2 the generator restores the current typography with a note', () => {
    const r = enforceCapabilities(changedFonts, VALID, DEFAULT_CAPABILITIES)
    expect(r.bundle.typography).toEqual(VALID.typography)
    expect(r.notes).toEqual(['Fonts are locked on this site (template below L2) — kept the current typography.'])
  })
  it('at L2 the fonts are kept and no note is added', () => {
    const r = enforceCapabilities(changedFonts, VALID, L2)
    expect(r.bundle.typography).toEqual(changedFonts.typography)
    expect(r.notes).toEqual([])
  })
  it('apply rejects a font change below L2, allows it at L2', () => {
    expect(capabilityViolations(changedFonts, VALID, DEFAULT_CAPABILITIES)).toEqual([
      'Fonts are locked on this site (template below L2) — this design changes the typography.',
    ])
    expect(capabilityViolations(changedFonts, VALID, L2)).toEqual([])
    expect(capabilityViolations(VALID, VALID, DEFAULT_CAPABILITIES)).toEqual([])
  })
})

describe('style axes (L3+)', () => {
  const L3 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.2', capabilities: ['fonts', 'style-axes'] }))
  const styled = { ...VALID, style: { cards: 'flat' as const } }
  it('below L3 the generator drops the style with a note', () => {
    const r = enforceCapabilities(styled, VALID, L2)
    expect(r.bundle.style).toBeUndefined()
    expect(r.notes.join(' ')).toContain('Style axes are not available on this site yet')
  })
  it('at L3 the style is kept', () => {
    const r = enforceCapabilities(styled, VALID, L3)
    expect(r.bundle.style).toEqual({ cards: 'flat' })
    expect(r.notes).toEqual([])
  })
  it('apply rejects a style change below L3, allows it at L3', () => {
    const v = capabilityViolations(styled, VALID, L2)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('Style axes are locked')
    expect(capabilityViolations(styled, VALID, L3)).toEqual([])
  })
  it('below L3 an unchanged style is not a violation', () => {
    expect(capabilityViolations(styled, styled, L2)).toEqual([])
  })
  it('below L3 a bundle keeping the site\'s existing style is left alone', () => {
    const r = enforceCapabilities(styled, styled, L2)
    expect(r.bundle.style).toEqual({ cards: 'flat' })
    expect(r.notes).toEqual([])
    expect(capabilityViolations(r.bundle, styled, L2)).toEqual([])
  })
  it('below L3 a style change is restored to the site\'s current style with a note', () => {
    const r = enforceCapabilities({ ...VALID, style: { nav: 'inverted' as const } }, styled, L2)
    expect(r.bundle.style).toEqual({ cards: 'flat' })
    expect(r.notes.join(' ')).toContain('Style axes are not available on this site yet')
    expect(capabilityViolations(r.bundle, styled, L2)).toEqual([])
    const dropped = enforceCapabilities(VALID, styled, L2)
    expect(dropped.bundle.style).toEqual({ cards: 'flat' })
    expect(dropped.notes).toHaveLength(1)
  })
  it('below L2 both fonts and style are reported', () => {
    const both = { ...styled, typography: { ...VALID.typography, headingFont: OTHER_FONT } }
    expect(capabilityViolations(both, VALID, DEFAULT_CAPABILITIES)).toHaveLength(2)
    const r = enforceCapabilities(both, VALID, DEFAULT_CAPABILITIES)
    expect(r.notes).toHaveLength(2)
    expect(r.bundle.typography).toEqual(VALID.typography)
    expect(r.bundle.style).toBeUndefined()
  })
})

describe('intersectWithShell', () => {
  const L4 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.2', capabilities: ['fonts', 'style-axes', 'specimen'] }))
  it('keeps only what the deployed shell also declares', () => {
    const c = intersectWithShell(L4, { status: 'verified', capabilities: ['fonts'] })
    expect(c).toMatchObject({ level: 2, capabilities: ['fonts'], shell: 'verified', source: 'marker', templateVersion: '2026.09.2' })
  })
  it('a shell with no meta drops the site to L1', () => {
    expect(intersectWithShell(L4, { status: 'verified', capabilities: [] }).level).toBe(1)
  })
  it('never raises the draft tier', () => {
    expect(intersectWithShell(L2, { status: 'verified', capabilities: ['fonts', 'style-axes', 'specimen'] }).level).toBe(2)
  })
  it('an unverified shell keeps the draft tier (flagged)', () => {
    expect(intersectWithShell(L4, { status: 'unverified' })).toEqual({ ...L4, shell: 'unverified' })
  })
  it('round-trips through capabilitiesFromJson', () => {
    const c = intersectWithShell(L4, { status: 'verified', capabilities: ['fonts', 'style-axes'] })
    expect(capabilitiesFromJson(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })
  it('exposes the tier helpers', () => {
    expect(capabilityLevel(['fonts', 'style-axes', 'specimen'])).toBe(4)
    expect(specimenUnlocked(L4)).toBe(true)
    expect(specimenUnlocked(L2)).toBe(false)
  })
})
