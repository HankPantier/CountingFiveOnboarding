// Pure + client-safe. The Design Studio run state machine, retry planning,
// and defensive parsing of the run's JSONB columns. No I/O — the orchestrator
// and routes act on it.
//   queued / generating → generate one concept per step.
//   refining → the critique loop (P4), one concept at a time in position
//     order: a concept's first render (pending → refining), then the units its
//     review (design_concepts.critique) names — critique / revise / re-render —
//     one per step, until the loop ends and the concept is finished (ready).
//     A pending concept parked mid-loop by a Retry resumes its loop.
//   Nothing left ⇒ finalize (ready).
import type { Tables } from '@/types/database'
import type { PriorConcept } from './brief'
import { parseDesignBundle } from './bundle'
import { displayHost, isPlainObject } from './input-validation'
import { parseRenderMetrics } from './metrics'
import { isClaimLive, parseConceptReview } from './review'
import { parseScreenshots } from './screenshots'
import { INPUT_KIND_LABELS, type DesignInputKind, type ThemeBlobShas } from './studio-types'
import { DEFAULT_RUN_PAGE, DESIGN_STEP_MAX_LIFETIME_MS, MAX_RUN_INPUTS, type RunBaseSnapshot, type RunStage } from './run-types'

export { parseScreenshots } from './screenshots'

export type RunLite = Pick<Tables<'design_runs'>, 'status' | 'stage' | 'concept_count'>
export type ConceptLite = Pick<Tables<'design_concepts'>, 'id' | 'position' | 'status' | 'bundle' | 'updated_at' | 'critique'>

// Generation is one concept per step: `generate` names the position to design
// next; once every position exists the run moves to render (≥ 1 usable
// concept) or fails (all rejected).
export type NextAction =
  | { kind: 'generate'; position: number }
  | { kind: 'start-render' }
  | { kind: 'no-concepts' }
  | { kind: 'render'; conceptId: string }
  // The critique loop (P4) — one unit of the concept already in its loop.
  | { kind: 'critique'; conceptId: string }
  | { kind: 'revise'; conceptId: string }
  | { kind: 'rerender'; conceptId: string }
  | { kind: 'finish-concept'; conceptId: string }
  // A pending concept parked mid-loop by a Retry: back to refining, review kept.
  | { kind: 'resume'; conceptId: string }
  | { kind: 'finalize' }
  | { kind: 'wait'; reason: string }
  | { kind: 'stop'; reason: string }

const TERMINAL = new Set(['ready', 'applied', 'cancelled', 'error'])

const byPosition = <T extends { position: number }>(list: T[]): T[] => [...list].sort((a, b) => a.position - b.position)

// An accepted concept: it has a bundle and wasn't rejected / is not mid-generation.
export function isUsableConcept(c: Pick<ConceptLite, 'status' | 'bundle'>): boolean {
  return c.bundle !== null && c.status !== 'rejected' && c.status !== 'generating'
}

// The first position in 0..count-1 with no concept row (any status), or null.
export function firstMissingPosition(concepts: Pick<ConceptLite, 'position'>[], count: number): number | null {
  const taken = new Set(concepts.map((c) => c.position))
  for (let p = 0; p < count; p++) if (!taken.has(p)) return p
  return null
}

export function nextAction(run: RunLite, concepts: ConceptLite[]): NextAction {
  if (TERMINAL.has(run.status)) return { kind: 'stop', reason: `run is ${run.status}` }
  if (run.status === 'queued' || run.status === 'generating') {
    if (concepts.some((c) => c.status === 'generating')) return { kind: 'wait', reason: 'a concept is being designed' }
    const position = firstMissingPosition(concepts, run.concept_count)
    if (position !== null) return { kind: 'generate', position }
    return concepts.some(isUsableConcept) ? { kind: 'start-render' } : { kind: 'no-concepts' }
  }
  if (run.status !== 'refining') return { kind: 'wait', reason: `run is ${run.status}` }
  const ordered = byPosition(concepts)
  // The critique loop: the concept already in its loop goes first; its review
  // says which unit is next. No review yet ⇒ its first render is in flight.
  for (const c of ordered) {
    if (c.status !== 'refining') continue
    const review = parseConceptReview(c.critique)
    if (!review) return { kind: 'wait', reason: 'a render is in flight' }
    if (review.claim) return { kind: 'wait', reason: `concept ${c.position + 1}: ${review.claim.unit} in flight` }
    switch (review.next) {
      case 'critique':
        return { kind: 'critique', conceptId: c.id }
      case 'revise':
        return { kind: 'revise', conceptId: c.id }
      case 'render':
        return { kind: 'rerender', conceptId: c.id }
      default:
        return { kind: 'finish-concept', conceptId: c.id }
    }
  }
  // Next pending concept: one parked mid-loop (it has a review) continues its
  // loop; otherwise its first render.
  const next = ordered.find((c) => c.status === 'pending' && c.bundle !== null)
  if (!next) return { kind: 'finalize' }
  return parseConceptReview(next.critique) ? { kind: 'resume', conceptId: next.id } : { kind: 'render', conceptId: next.id }
}

export type RetryPlan =
  | { ok: true; status: 'queued' | 'refining'; stage: RunStage; resetConceptIds: string[]; deleteConceptIds: string[]; resumeConceptIds: string[] }
  | { ok: false; reason: string }

export const CONCEPT_STILL_REFINING = 'A concept is still being critiqued or revised — try again in a few minutes.'

// Retry resumes from the first stage that isn't done.
//   Past generation (stage render, or a concept already rendered) with a usable
//   concept ⇒ render whatever didn't finish (swept 'error' / stuck 'refining').
//   Otherwise ⇒ generate again from the first missing position: accepted and
//   rejected concepts are kept (no re-spend); an errored / stale 'generating'
//   position is deleted so it is designed again (a 'generating' row younger
//   than a step's max lifetime refuses the retry — its worker may be alive). When every position was
//   rejected (or generation finished with nothing usable) all rows are deleted
//   and generation starts over.
export const CONCEPT_STILL_DESIGNING = 'A concept is still being designed — try again in a few minutes.'

// A 'generating' row whose claim is older than any step can live: its worker
// is gone. A younger one may still have a live worker (the run can be errored
// by a failed chain trigger while a generate step is still running).
function isStaleGenerating(c: Pick<ConceptLite, 'status' | 'updated_at'>, now: number): boolean {
  const at = Date.parse(c.updated_at)
  return c.status === 'generating' && (!Number.isFinite(at) || now - at > DESIGN_STEP_MAX_LIFETIME_MS)
}

export function planRetry(run: RunLite, concepts: ConceptLite[], now: number = Date.now()): RetryPlan {
  if (run.status !== 'error') return { ok: false, reason: 'Only a failed run can be retried.' }
  if (concepts.some((c) => c.status === 'generating' && !isStaleGenerating(c, now))) return { ok: false, reason: CONCEPT_STILL_DESIGNING }
  const usable = concepts.filter((c) => c.bundle !== null && c.status !== 'rejected')
  const pastGeneration = run.stage !== 'generate' || concepts.some((c) => c.status === 'refining' || c.status === 'ready')
  if (pastGeneration && usable.length > 0) {
    // Mid-loop concepts (a review exists, not finished) RESUME at their next
    // unit, claim cleared — resumeConcepts puts the first (by position) back
    // to refining and parks the rest as pending (nextAction resumes each in
    // turn). A loop claim younger than a step's lifetime may still have a live
    // worker, so the retry waits. Others restart their first render (P3).
    const inLoop = usable.filter(
      (c) => (c.status === 'refining' || c.status === 'error' || c.status === 'pending') && parseConceptReview(c.critique) !== null
    )
    if (inLoop.some((c) => isClaimLive(parseConceptReview(c.critique)?.claim ?? null, now))) return { ok: false, reason: CONCEPT_STILL_REFINING }
    return {
      ok: true,
      status: 'refining',
      stage: 'render',
      resetConceptIds: byPosition(usable)
        .filter((c) => !inLoop.includes(c) && (c.status === 'refining' || c.status === 'error' || c.status === 'generating'))
        .map((c) => c.id),
      deleteConceptIds: [],
      resumeConceptIds: byPosition(inLoop).map((c) => c.id),
    }
  }
  const stale = concepts.filter((c) => c.status === 'error' || c.status === 'generating')
  const kept = concepts.filter((c) => !stale.includes(c))
  const startOver = pastGeneration || (!kept.some(isUsableConcept) && firstMissingPosition(kept, run.concept_count) === null)
  return {
    ok: true,
    status: 'queued',
    stage: 'generate',
    resetConceptIds: [],
    deleteConceptIds: byPosition(startOver ? concepts : stale).map((c) => c.id),
    resumeConceptIds: [],
  }
}

// The accepted concepts (valid stored bundles) as priors, by position —
// optionally without one (the concept being critiqued / revised).
export function usablePriors(concepts: Pick<ConceptLite, 'id' | 'position' | 'status' | 'bundle'>[], exceptId?: string): PriorConcept[] {
  return byPosition(concepts)
    .filter((c) => c.id !== exceptId && isUsableConcept(c))
    .flatMap((c) => {
      const parsed = parseDesignBundle(c.bundle)
      return parsed.ok ? [{ position: c.position, bundle: parsed.bundle }] : []
    })
}

export function parseBaseSnapshot(value: unknown): RunBaseSnapshot {
  const v = isPlainObject(value) ? value : {}
  const themeShas: ThemeBlobShas = {}
  if (isPlainObject(v.themeShas)) for (const [k, sha] of Object.entries(v.themeShas)) if (typeof sha === 'string') themeShas[k] = sha
  return {
    pagePath: typeof v.pagePath === 'string' && v.pagePath.startsWith('/') ? v.pagePath : DEFAULT_RUN_PAGE,
    themeShas,
    screenshots: parseScreenshots(v.screenshots),
    notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string') : [],
    metrics: parseRenderMetrics(v.metrics),
  }
}

type InputRow = Tables<'design_inputs'>
export type UsableInput = InputRow & { storage_path: string }
export type InputSelection = { usable: UsableInput[]; skipped: { label: string; reason: string }[] }

export function inputLabel(row: InputRow): string {
  return row.label ?? displayHost(row.url) ?? INPUT_KIND_LABELS[row.kind as DesignInputKind] ?? 'An input'
}

// Our own description of an input image for the prompt (never admin text —
// the admin's label/notes are fenced separately).
export function inputCaption(row: InputRow): string {
  const kind = INPUT_KIND_LABELS[row.kind as DesignInputKind] ?? 'Reference'
  const host = displayHost(row.url)
  return host ? `${kind} screenshot (${host})` : `${kind}`
}

// The run's chosen inputs, in the admin's order, split into usable (captured,
// not archived, under the cap) and skipped-with-a-reason. Never blocks a run.
export function selectRunInputs(rows: InputRow[], inputIds: string[]): InputSelection {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const usable: UsableInput[] = []
  const skipped: { label: string; reason: string }[] = []
  for (const id of inputIds) {
    const row = byId.get(id)
    if (!row) {
      skipped.push({ label: 'An input', reason: 'it was deleted' })
      continue
    }
    if (row.archived) {
      skipped.push({ label: inputLabel(row), reason: 'it is archived' })
      continue
    }
    if (row.capture_status !== 'ok' || !row.storage_path) {
      skipped.push({ label: inputLabel(row), reason: 'it has not been captured yet' })
      continue
    }
    if (usable.length >= MAX_RUN_INPUTS) {
      skipped.push({ label: inputLabel(row), reason: `the run already has ${MAX_RUN_INPUTS} reference images` })
      continue
    }
    usable.push({ ...row, storage_path: row.storage_path })
  }
  return { usable, skipped }
}
