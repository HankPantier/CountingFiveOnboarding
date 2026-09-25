import { describe, it, expect } from 'vitest'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES, rawOf } from './__fixtures__/theme-texts'
import { parseConceptsEnvelope, validateConceptBundle, type ConceptContext } from './concept-validate'
import { DEFAULT_CAPABILITIES } from './run-types'

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

  it('strips a style field with a note', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), style: { cards: 'flat' } }, CTX)
    expect(r.ok && r.concept.notes).toEqual([expect.stringContaining('Style axes')])
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

  it('rejects a palette that fails WCAG contrast', () => {
    const r = validateConceptBundle({ ...rawOf(VALID), palette: { ...VALID.palette, nearBlack: '#fafaf6', nearWhite: '#fafaf7' } }, CTX)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/^contrast /)
  })

  it('rejects a non-object', () => {
    expect(validateConceptBundle('nope', CTX)).toEqual({ ok: false, errors: ['The concept is not a JSON object.'] })
  })
})
