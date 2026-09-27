// Server-only (bundle-files → css-sanitizer → lightningcss). Turns ONE raw
// model concept into a canonical, safe DesignBundle — or a list of errors the
// repair retry can quote back to the model:
//   1. force schemaVersion/meta; clamp over-long prose (clampConceptProse)
//   2. zod (parseDesignBundle)
//   3. capability tier (fonts below L2 / style below L3 → current, with a note)
//   4. palette freedom "keep" → the current palette, with a note
//   5. render the repo files with removeLegacy (sanitizes every CSS fragment)
//   6. checkThemeContrast (the same hard gate apply uses)
// The stored bundle carries the SANITIZED css (what apply would write).
import type { BrandJson } from '@/types/brand-json'
import { checkThemeContrast } from '@/lib/content/theme-css-generator'
import {
  BUNDLE_MAX_MOVES,
  BUNDLE_MOVE_MAX_LENGTH,
  BUNDLE_RATIONALE_MAX_LENGTH,
  BUNDLE_TAGLINE_MAX_LENGTH,
  parseDesignBundle,
  type DesignBundle,
} from './bundle'
import { bundleToRepoFiles, type RenderedThemeFiles, type RepoThemeFiles } from './bundle-files'
import type { PriorConcept } from './brief'
import { enforceCapabilities } from './capabilities'
import { conceptConsistencyNotes } from './concept-consistency'
import { isNearDuplicate } from './distinctness'
import { isPlainObject } from './input-validation'
import type { DesignCapabilities, PaletteFreedom } from './run-types'

export type ConceptContext = {
  current: DesignBundle
  caps: DesignCapabilities
  paletteFreedom: PaletteFreedom
  draftFiles: RepoThemeFiles
  model: string
}
export type ValidConcept = { bundle: DesignBundle; files: RenderedThemeFiles; notes: string[] }
export type ConceptValidation = { ok: true; concept: ValidConcept } | { ok: false; errors: string[] }

const KEEP_NOTE = 'Palette freedom is "keep" — the current palette was restored.'

// Cuts `text` to at most `max` chars at a word boundary, ending in "…".
export function clampProse(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// The descriptive prose (tagline, rationale, moves) is shown to people and
// quoted to the critic; it never changes how the design renders. A model
// answer that runs over its caps is clamped here instead of failing zod — a
// revision whose rationale grew past 2000 chars (it narrates what changed on
// top of the original) used to throw away a whole paid-for revision
// ("rationale: Too big") with no repair turn. Non-strings are left for zod.
export function clampConceptProse(candidate: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...candidate }
  if (typeof out.tagline === 'string') out.tagline = clampProse(out.tagline, BUNDLE_TAGLINE_MAX_LENGTH)
  if (typeof out.rationale === 'string') out.rationale = clampProse(out.rationale, BUNDLE_RATIONALE_MAX_LENGTH)
  if (Array.isArray(out.moves) && out.moves.every((m) => typeof m === 'string')) {
    out.moves = (out.moves as string[]).slice(0, BUNDLE_MAX_MOVES).map((m) => clampProse(m, BUNDLE_MOVE_MAX_LENGTH))
  }
  return out
}

export function parseConceptsEnvelope(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (isPlainObject(value) && Array.isArray(value.concepts)) return value.concepts
  return null
}

function samePalette(a: DesignBundle['palette'], b: DesignBundle['palette']): boolean {
  return (Object.keys(a) as (keyof DesignBundle['palette'])[]).every((k) => a[k] === b[k])
}

export function validateConceptBundle(raw: unknown, ctx: ConceptContext): ConceptValidation {
  if (!isPlainObject(raw)) return { ok: false, errors: ['The concept is not a JSON object.'] }
  const notes: string[] = []
  const candidate: Record<string, unknown> = clampConceptProse(raw)
  delete candidate.meta
  delete candidate.schemaVersion

  const parsed = parseDesignBundle({ ...candidate, schemaVersion: 1, meta: { source: 'concept', model: ctx.model } })
  if (!parsed.ok) return { ok: false, errors: parsed.errors }

  const enforced = enforceCapabilities(parsed.bundle, ctx.current, ctx.caps)
  let bundle = enforced.bundle
  notes.push(...enforced.notes)

  if (ctx.paletteFreedom === 'keep' && !samePalette(bundle.palette, ctx.current.palette)) {
    bundle = { ...bundle, palette: { ...ctx.current.palette } }
    notes.push(KEEP_NOTE)
  }

  const rendered = bundleToRepoFiles(bundle, ctx.draftFiles, { removeLegacy: true })
  if (!rendered.ok) return { ok: false, errors: rendered.errors }

  const contrast = checkThemeContrast(JSON.parse(rendered.files.brandText) as BrandJson)
  if (contrast.length > 0) {
    return { ok: false, errors: contrast.map((f) => `contrast ${f.name}: ${f.ratio.toFixed(2)}:1 (need ${f.minRatio}:1)`) }
  }
  return { ok: true, concept: { bundle: { ...bundle, css: rendered.css }, files: rendered.files, notes } }
}

// P7: the concept's self-consistency notes (concept-consistency.ts) appended
// to its validation notes. Generation + revision only — the design chat edits
// a working bundle whose description it never rewrites, so it skips this.
export function withConsistencyNotes(concept: ValidConcept, caps: DesignCapabilities): ValidConcept {
  const extra = conceptConsistencyNotes(concept.bundle, caps).filter((n) => !concept.notes.includes(n))
  return extra.length > 0 ? { ...concept, notes: [...concept.notes, ...extra] } : concept
}

// The same notes for a raw answer that failed validation (quoted in the P3
// repair turn alongside its errors); [] when it doesn't even parse.
export function rawConsistencyNotes(raw: unknown, ctx: Pick<ConceptContext, 'caps' | 'model'>): string[] {
  if (!isPlainObject(raw)) return []
  const parsed = parseDesignBundle({ ...clampConceptProse(raw), schemaVersion: 1, meta: { source: 'concept', model: ctx.model } })
  return parsed.ok ? conceptConsistencyNotes(parsed.bundle, ctx.caps) : []
}

// ONE model answer → a usable concept, or the errors to quote back: missing,
// invalid (validateConceptBundle) or a near-duplicate of one of `others` (the
// run's other accepted concepts). Shared by concept generation (incl. its
// repair turn, prefix "after repair: ") and the P4 reviser.
export function checkConceptCandidate(raw: unknown, ctx: ConceptContext, others: PriorConcept[], prefix = ''): ConceptValidation {
  if (raw === undefined) return { ok: false, errors: [`${prefix}missing — the answer had no concept`] }
  const v = validateConceptBundle(raw, ctx)
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => `${prefix}${e}`) }
  const clash = others.find((p) => isNearDuplicate(p.bundle, v.concept.bundle))
  if (clash) {
    return {
      ok: false,
      errors: [
        `${prefix}too similar to concept ${clash.position + 1} ("${clash.bundle.name.slice(0, 60)}") — change the palette direction (primary/action) or at least two of fonts, tokens and treatments`,
      ],
    }
  }
  return v
}
