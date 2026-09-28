import { describe, it, expect } from 'vitest'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES } from './__fixtures__/theme-texts'
import { bundleToRepoFiles } from './bundle-files'
import {
  capabilitiesFromJson,
  capabilityLevel,
  capabilityViolations,
  enforceCapabilities,
  fontsUnlocked,
  effectiveTemplateVersion,
  intersectWithShell,
  keepLockedLayout,
  keepLockedLevers,
  keepLockedStyle,
  layoutPresetsUnlocked,
  SHELL_WITHOUT_VERSION_META,
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
  })
  it('below L3 an ABSENT style (pre-P6b version/concept) keeps the current axes silently', () => {
    const kept = enforceCapabilities(VALID, styled, L2)
    expect(kept.bundle.style).toEqual({ cards: 'flat' })
    expect(kept.notes).toEqual([])
    expect(capabilityViolations(VALID, styled, L2)).toEqual([])
    expect(keepLockedStyle(VALID, styled, L2).style).toEqual({ cards: 'flat' })
  })
  it('rendering keepLockedStyle(style-less bundle) below L3 keeps the axes in design.json', () => {
    const designText = JSON.stringify({ ...JSON.parse(DRAFT_FILES.designText), style: { cards: 'flat' } })
    const r = bundleToRepoFiles(keepLockedStyle(VALID, styled, L2), { ...DRAFT_FILES, designText }, { removeLegacy: false })
    expect(r.ok).toBe(true)
    if (r.ok) expect(JSON.parse(r.files.designText).style).toEqual({ cards: 'flat' })
  })
  it('at L3+ an absent style is left absent (all default), and an explicit change below L3 is still rejected', () => {
    expect(keepLockedStyle(VALID, styled, L3).style).toBeUndefined()
    expect(capabilityViolations({ ...VALID, style: { nav: 'inverted' as const } }, styled, L2)).toHaveLength(1)
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
  it('a not-Revaltus shell keeps the draft tier and carries the reason as shellNote', () => {
    expect(intersectWithShell(L4, { status: 'unverified', reason: 'old site' })).toEqual({ ...L4, shell: 'unverified', shellNote: 'old site' })
  })
  it('capabilitiesFromJson round-trips shellNote on an unverified snapshot only', () => {
    const snap = intersectWithShell(L4, { status: 'unverified', reason: 'old site' })
    expect(capabilitiesFromJson(JSON.parse(JSON.stringify(snap)))).toEqual(snap)
    expect(capabilitiesFromJson({ ...L4, shell: 'verified', shellNote: 'x' })).not.toHaveProperty('shellNote')
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

describe('layout presets (capability flag, 2026.09.9)', () => {
  const L4 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.8', capabilities: ['fonts', 'style-axes', 'specimen'] }))
  const L4P = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.9', capabilities: ['fonts', 'style-axes', 'specimen', 'layout-presets'] }))
  const laid = { ...VALID, layout: { cards: 'list' as const } }
  it('is a flag, not a level', () => {
    expect(L4P.level).toBe(4)
    expect(layoutPresetsUnlocked(L4P)).toBe(true)
    expect(layoutPresetsUnlocked(L4)).toBe(false)
    expect(layoutPresetsUnlocked(DEFAULT_CAPABILITIES)).toBe(false)
  })
  it('locked: the generator drops a new layout with a note; unlocked keeps it', () => {
    const r = enforceCapabilities(laid, VALID, L4)
    expect(r.bundle.layout).toBeUndefined()
    expect(r.notes.join(' ')).toContain('Layout presets are not available')
    const ok = enforceCapabilities(laid, VALID, L4P)
    expect(ok.bundle.layout).toEqual({ cards: 'list' })
    expect(ok.notes).toEqual([])
  })
  it('locked: a layout change is restored to the current layout; an absent layout keeps it silently', () => {
    const r = enforceCapabilities({ ...VALID, layout: { faq: 'split' as const } }, laid, L4)
    expect(r.bundle.layout).toEqual({ cards: 'list' })
    expect(r.notes).toHaveLength(1)
    const kept = enforceCapabilities(VALID, laid, L4)
    expect(kept.bundle.layout).toEqual({ cards: 'list' })
    expect(kept.notes).toEqual([])
    expect(keepLockedLayout(VALID, laid, L4).layout).toEqual({ cards: 'list' })
    expect(keepLockedLayout(VALID, laid, L4P).layout).toBeUndefined()
    expect(keepLockedLevers(VALID, { ...laid, style: { cards: 'flat' } }, L2)).toMatchObject({ layout: { cards: 'list' }, style: { cards: 'flat' } })
  })
  it('apply rejects a layout change when locked, allows it when unlocked', () => {
    const v = capabilityViolations(laid, VALID, L4)
    expect(v).toEqual([expect.stringContaining('Layout presets are locked')])
    expect(capabilityViolations(laid, VALID, L4P)).toEqual([])
    expect(capabilityViolations(VALID, laid, L4)).toEqual([])
    expect(capabilityViolations(laid, laid, L4)).toEqual([])
  })
  it('rendering keepLockedLayout(layout-less bundle) when locked keeps design.json layout', () => {
    const designText = JSON.stringify({ ...JSON.parse(DRAFT_FILES.designText), layout: { cards: 'list' } })
    const r = bundleToRepoFiles(keepLockedLayout(VALID, laid, L4), { ...DRAFT_FILES, designText }, { removeLegacy: false })
    expect(r.ok && JSON.parse(r.files.designText).layout).toEqual({ cards: 'list' })
  })
  it('the flag goes through the shell intersection', () => {
    expect(layoutPresetsUnlocked(intersectWithShell(L4P, { status: 'verified', capabilities: ['fonts', 'style-axes', 'specimen'] }))).toBe(false)
    expect(layoutPresetsUnlocked(intersectWithShell(L4P, { status: 'verified', capabilities: ['fonts', 'style-axes', 'specimen', 'layout-presets'], templateVersion: '2026.09.9' }))).toBe(true)
    expect(layoutPresetsUnlocked(intersectWithShell(L4P, { status: 'unverified' }))).toBe(true)
  })
})

describe('effective template version = min(draft, shell meta)', () => {
  const v = (templateVersion?: string | null) => ({ status: 'verified' as const, capabilities: [], templateVersion })
  it('takes the older of draft and shell', () => {
    expect(effectiveTemplateVersion('2026.09.9', v('2026.09.9'))).toBe('2026.09.9')
    expect(effectiveTemplateVersion('2026.09.10', v('2026.09.9'))).toBe('2026.09.9')
    expect(effectiveTemplateVersion('2026.09.9', v('2026.09.10'))).toBe('2026.09.9')
  })
  it('a verified shell without the meta counts as 2026.09.8', () => {
    expect(SHELL_WITHOUT_VERSION_META).toBe('2026.09.8')
    expect(effectiveTemplateVersion('2026.09.9', v(undefined))).toBe('2026.09.8')
    expect(effectiveTemplateVersion('2026.09.9', v(null))).toBe('2026.09.8')
    expect(effectiveTemplateVersion('2026.09.9', v('garbage'))).toBe('2026.09.8')
    expect(effectiveTemplateVersion('2026.09.5', v(null))).toBe('2026.09.5')
  })
  it('an unverified shell keeps the draft version; no draft version stays null', () => {
    expect(effectiveTemplateVersion('2026.09.9', { status: 'unverified' })).toBe('2026.09.9')
    expect(effectiveTemplateVersion(null, v('2026.09.9'))).toBeNull()
  })
  it('intersectWithShell carries the effective version (and it round-trips)', () => {
    const d = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.9', capabilities: ['fonts'] }))
    const c = intersectWithShell(d, v(null))
    expect(c.templateVersion).toBe('2026.09.8')
    expect(capabilitiesFromJson(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })
})
