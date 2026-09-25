// Pure + client-safe. The Design Studio run state machine (P3: generate one
// concept per step → render one concept per step → ready), retry planning,
// and defensive parsing of the run's JSONB columns. No I/O — the orchestrator
// and routes act on it.
import type { Tables } from '@/types/database'
import { displayHost, isPlainObject } from './input-validation'
import { INPUT_KIND_LABELS, type DesignInputKind, type ThemeBlobShas } from './studio-types'
import { DEFAULT_RUN_PAGE, MAX_RUN_INPUTS, type RunBaseSnapshot, type RunScreenshot, type RunStage } from './run-types'

export type RunLite = Pick<Tables<'design_runs'>, 'status' | 'stage' | 'concept_count'>
export type ConceptLite = Pick<Tables<'design_concepts'>, 'id' | 'position' | 'status' | 'bundle'>

// Generation is one concept per step: `generate` names the position to design
// next; once every position exists the run moves to render (≥ 1 usable
// concept) or fails (all rejected).
export type NextAction =
  | { kind: 'generate'; position: number }
  | { kind: 'start-render' }
  | { kind: 'no-concepts' }
  | { kind: 'render'; conceptId: string }
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
  if (concepts.some((c) => c.status === 'refining')) return { kind: 'wait', reason: 'a render is in flight' }
  const next = byPosition(concepts).find((c) => c.status === 'pending' && c.bundle !== null)
  return next ? { kind: 'render', conceptId: next.id } : { kind: 'finalize' }
}

export type RetryPlan =
  | { ok: true; status: 'queued' | 'refining'; stage: RunStage; resetConceptIds: string[]; deleteConceptIds: string[] }
  | { ok: false; reason: string }

// Retry resumes from the first stage that isn't done.
//   Past generation (stage render, or a concept already rendered) with a usable
//   concept ⇒ render whatever didn't finish (swept 'error' / stuck 'refining').
//   Otherwise ⇒ generate again from the first missing position: accepted and
//   rejected concepts are kept (no re-spend); an errored / stale 'generating'
//   position is deleted so it is designed again. When every position was
//   rejected (or generation finished with nothing usable) all rows are deleted
//   and generation starts over.
export function planRetry(run: RunLite, concepts: ConceptLite[]): RetryPlan {
  if (run.status !== 'error') return { ok: false, reason: 'Only a failed run can be retried.' }
  const usable = concepts.filter((c) => c.bundle !== null && c.status !== 'rejected')
  const pastGeneration = run.stage !== 'generate' || concepts.some((c) => c.status === 'refining' || c.status === 'ready')
  if (pastGeneration && usable.length > 0) {
    return {
      ok: true,
      status: 'refining',
      stage: 'render',
      resetConceptIds: byPosition(usable)
        .filter((c) => c.status === 'refining' || c.status === 'error' || c.status === 'generating')
        .map((c) => c.id),
      deleteConceptIds: [],
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
  }
}

export function parseScreenshots(value: unknown): RunScreenshot[] {
  if (!Array.isArray(value)) return []
  const out: RunScreenshot[] = []
  for (const s of value) {
    if (!isPlainObject(s)) continue
    const { viewport, path, width, height } = s
    if (viewport !== 'desktop' && viewport !== 'mobile') continue
    if (typeof path !== 'string' || !path.startsWith('design/') || path.includes('..')) continue
    if (typeof width !== 'number' || typeof height !== 'number') continue
    out.push({ viewport, path, width, height })
  }
  return out
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
