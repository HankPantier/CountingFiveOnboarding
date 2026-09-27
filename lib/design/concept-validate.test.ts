import { describe, it, expect } from 'vitest'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES, rawOf } from './__fixtures__/theme-texts'
import { checkConceptCandidate, clampConceptProse, clampProse, parseConceptsEnvelope, validateConceptBundle, type ConceptContext } from './concept-validate'
import { DEFAULT_CAPABILITIES } from './run-types'
import { parseTemplateMarker } from './capabilities'

const CTX: ConceptContext = { current: VALID, caps: DEFAULT_CAPABILITIES, paletteFreedom: 'evolve', draftFiles: DRAFT_FILES, model: 'claude-opus-5-5' }
const OTHER_FONT = CURATED_FONTS.find((f) => f !== 'Public Sans' && f !== 'Fraunces') as string

describe('parseConceptsEnvelope', () => {
  it('accepts {concepts:[…]} or a bare array', () => {
    expect(parseConceptsEnvelope({ concepts: [1, 2] })).toEqual([1, 2])
    expect(parseConceptsEnvelope([3])).toEqual([3])
  })
  it.each([null, 'x', { concepts: 'no' }, { other: [] }])('rejects %j', (v) => {
    expect(parseConceptsEnvelope(v)).toBeNull()
  })
})

describe('validateConceptBundle', () => {
  it('accepts a good concept, forcing schemaVersion + concept meta, and renders its files', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), meta: { source: 'baseline' } }, CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.concept.bundle.schemaVersion).toBe(1)
    expect(r.concept.bundle.meta).toEqual({ source: 'concept', model: 'claude-opus-5-5' })
    expect(r.concept.files.themeCss.length).toBeGreaterThan(100)
    expect(r.concept.files.overridesCss).toContain('/* design-studio:hero */')
    expect(r.concept.bundle.css.blocks.hero).toBeTruthy()
    expect(r.concept.notes).toEqual([])
  })

  it('rejects a schema violation with the zod path', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), palette: { ...VALID.palette, primary: 'navy' } }, CTX)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('palette.primary')
  })

  it('drops a style field below L3 with a note', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), style: { cards: 'flat' } }, CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.concept.bundle.style).toBeUndefined()
    expect(r.concept.notes).toEqual([expect.stringContaining('Style axes are not available on this site yet')])
    expect(JSON.parse(r.concept.files.designText).style).toBeUndefined()
  })

  it('keeps a style field at L3 and writes it to design.json', () => {
    const L3 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.2', capabilities: ['fonts', 'style-axes'] }))
    const r = validateConceptBundle({ ...rawOf(VALID), style: { cards: 'flat' } }, { ...CTX, caps: L3 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.concept.bundle.style).toEqual({ cards: 'flat' })
    expect(r.concept.notes).toEqual([])
    expect(JSON.parse(r.concept.files.designText).style).toEqual({ cards: 'flat' })
  })

  it('rejects an unknown style axis value', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), style: { cards: 'wobbly' } }, CTX)
    expect(r.ok).toBe(false)
  })

  it('restores the current fonts below L2 with a note', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), typography: { headingFont: OTHER_FONT, bodyFont: OTHER_FONT, accentFont: 'Fraunces' } }, CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.concept.bundle.typography).toEqual(VALID.typography)
    expect(r.concept.notes[0]).toContain('Fonts are locked')
  })

  it('restores the current palette when palette freedom is keep', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), palette: { ...VALID.palette, primary: '#5c1a2b' } }, { ...CTX, paletteFreedom: 'keep' })
    expect(r.ok && r.concept.bundle.palette.primary).toBe(VALID.palette.primary)
    expect(r.ok && r.concept.notes).toEqual([expect.stringContaining('keep')])
  })

  it('rejects CSS the sanitizer refuses', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), css: { global: 'body { color: red; }', blocks: {} } }, CTX)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/^css\.global:/)
  })

  it('rejects a concept that introduces a failing action / primary pair, naming the fix', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), palette: { ...VALID.palette, primary: '#003a42', action: '#cc381e' } }, CTX)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual([expect.stringMatching(/^contrast action \/ primary: 2\.4\d:1 \(need 4\.5:1\) — /)])
  })
  it('keeps a site whose current palette already fails action / primary designable (keep + evolve-unchanged)', () => {
    const legacy = { ...VALID, palette: { ...VALID.palette, primary: '#003a42', action: '#cc381e' } }
    const ctx = { ...CTX, current: legacy }
    expect(validateConceptBundle({ ...rawOf(VALID), palette: { ...VALID.palette, primary: '#5c1a2b' } }, { ...ctx, paletteFreedom: 'keep' }).ok).toBe(true)
    expect(validateConceptBundle({ ...rawOf(VALID), palette: legacy.palette }, ctx).ok).toBe(true)
  })
  it('rejects a palette that fails WCAG contrast', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), palette: { ...VALID.palette, nearBlack: '#fafaf6', nearWhite: '#fafaf7' } }, CTX)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/^contrast /)
  })

  it('rejects a non-object', () => {
    expect(validateConceptBundle('nope', CTX)).toEqual({ ok: false, errors: ['The concept is not a JSON object.'] })
  })
})

describe('checkConceptCandidate', () => {
  const OTHER = { ...VALID, name: 'Other' }
  it('a missing answer is an error (prefixed)', () => {
    expect(checkConceptCandidate(undefined, CTX, [], 'after repair: ')).toEqual({ ok: false, errors: ['after repair: missing — the answer had no concept'] })
  })
  it('passes validation errors through, prefixed', () => {
    const r = checkConceptCandidate({ ...rawOf(VALID), palette: { ...VALID.palette, primary: 'navy' } }, CTX, [], 'p: ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.every((e) => e.startsWith('p: '))).toBe(true)
  })
  it('rejects a near-duplicate of another concept, naming it', () => {
    const r = checkConceptCandidate(rawOf(VALID), CTX, [{ position: 2, bundle: OTHER }])
    expect(r).toEqual({
      ok: false,
      errors: ['too similar to concept 3 ("Other") — change the palette direction (primary/action) or at least two of fonts, tokens and treatments'],
    })
  })
  it('returns the validated concept when valid and distinct', () => {
    const r = checkConceptCandidate(rawOf(VALID), CTX, [])
    expect(r.ok && r.concept.bundle.name).toBe(VALID.name)
  })
})

describe('clampProse / clampConceptProse', () => {
  it('leaves text within the cap alone', () => {
    expect(clampProse('short', 10)).toBe('short')
    expect(clampProse('x'.repeat(10), 10)).toBe('x'.repeat(10))
  })
  it('cuts at a word boundary and ends in an ellipsis, never over the cap', () => {
    const out = clampProse('alpha beta gamma delta epsilon', 20)
    expect(out).toBe('alpha beta gamma…')
    expect(out.length).toBeLessThanOrEqual(20)
    expect(clampProse('x'.repeat(50), 20)).toBe(`${'x'.repeat(19)}…`)
  })
  it('clamps tagline / rationale / moves; leaves non-strings for zod to reject', () => {
    const out = clampConceptProse({ tagline: 't '.repeat(200), rationale: 'r '.repeat(1500), moves: Array.from({ length: 9 }, () => 'm '.repeat(150)), name: 'N' })
    expect((out.tagline as string).length).toBeLessThanOrEqual(160)
    expect((out.rationale as string).length).toBeLessThanOrEqual(2000)
    expect(out.moves as string[]).toHaveLength(6)
    expect(out.name).toBe('N')
    expect(clampConceptProse({ rationale: 42, moves: [1, 'a'] })).toEqual({ rationale: 42, moves: [1, 'a'] })
  })
  it('an over-long rationale no longer fails validation', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), rationale: 'word '.repeat(600) }, CTX)
    expect(r.ok).toBe(true)
  })
})
