// Pure + client-safe. One concept's critique-loop state, stored in
// design_concepts.critique (jsonb — migration 078 has no dedicated columns):
// the next unit, the live claim, the latest render's metrics (null = the
// latest bundle is unmeasured), the iteration-0 screenshots (BeforeAfter's
// "before"), the last 3 critiques, how the loop ended, and its notes. Plus
// the loop decision, notes scoping for Retry, and the apply render gate.
import { isPlainObject } from './input-validation'
import { parseCritiqueRecord, type CritiqueRecord } from './critique'
import { metricGateFailures, parseRenderMetrics, type RenderMetrics } from './metrics'
import { parseScreenshots } from './screenshots'
import { DESIGN_STEP_MAX_LIFETIME_MS, type RunScreenshot } from './run-types'

export const REVIEW_UNITS = ['render', 'critique', 'revise'] as const
export type ReviewUnit = (typeof REVIEW_UNITS)[number]
export type ReviewNext = ReviewUnit | 'done'
export const REVIEW_OUTCOMES = ['passed', 'max_revisions', 'cost_cap', 'invalid_revision', 'critic_unavailable', 'not_rendered'] as const
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number]
export const MAX_REVIEW_NOTES = 12
export const MAX_STORED_CRITIQUES = 3

export type ReviewClaim = { unit: ReviewUnit; at: string }
export type ConceptReview = {
  v: 1
  next: ReviewNext
  claim: ReviewClaim | null
  metrics: RenderMetrics | null
  metricsIteration: number | null
  initialScreenshots: RunScreenshot[]
  critiques: CritiqueRecord[]
  outcome: ReviewOutcome | null
  notes: string[]
}

export function newReview(): ConceptReview {
  return { v: 1, next: 'render', claim: null, metrics: null, metricsIteration: null, initialScreenshots: [], critiques: [], outcome: null, notes: [] }
}

const NEXT: readonly string[] = [...REVIEW_UNITS, 'done']

export function parseConceptReview(value: unknown): ConceptReview | null {
  if (!isPlainObject(value) || value.v !== 1 || typeof value.next !== 'string' || !NEXT.includes(value.next)) return null
  let claim: ReviewClaim | null = null
  if (isPlainObject(value.claim) && (REVIEW_UNITS as readonly unknown[]).includes(value.claim.unit) && typeof value.claim.at === 'string') {
    claim = { unit: value.claim.unit as ReviewUnit, at: value.claim.at }
  }
  const critiques = Array.isArray(value.critiques)
    ? value.critiques.flatMap((c) => {
        const r = parseCritiqueRecord(c)
        return r ? [r] : []
      })
    : []
  return {
    v: 1,
    next: value.next as ReviewNext,
    claim,
    metrics: parseRenderMetrics(value.metrics),
    metricsIteration: typeof value.metricsIteration === 'number' && Number.isInteger(value.metricsIteration) ? value.metricsIteration : null,
    initialScreenshots: parseScreenshots(value.initialScreenshots),
    critiques: critiques.slice(-MAX_STORED_CRITIQUES),
    outcome: (REVIEW_OUTCOMES as readonly unknown[]).includes(value.outcome) ? (value.outcome as ReviewOutcome) : null,
    notes: Array.isArray(value.notes) ? value.notes.filter((n): n is string => typeof n === 'string').slice(0, MAX_REVIEW_NOTES) : [],
  }
}

export function latestCritique(review: Pick<ConceptReview, 'critiques'>): CritiqueRecord | null {
  return review.critiques.at(-1) ?? null
}

export function withCritique(review: ConceptReview, record: CritiqueRecord): ConceptReview {
  return { ...review, critiques: [...review.critiques, record].slice(-MAX_STORED_CRITIQUES) }
}

export function withReviewNotes(review: ConceptReview, notes: string[]): ConceptReview {
  return { ...review, notes: [...new Set([...review.notes, ...notes])].slice(0, MAX_REVIEW_NOTES) }
}

export function endReview(review: ConceptReview, outcome: ReviewOutcome, notes: string[] = []): ConceptReview {
  return withReviewNotes({ ...review, next: 'done', outcome, claim: null }, notes)
}

export type LoopDecision = { kind: 'revise' } | { kind: 'done'; outcome: ReviewOutcome }

// After a critique: pass (rubric pass AND no render-check failure) ends the
// loop; otherwise revise while revisions and budget remain.
export function decideAfterCritique(input: { passed: boolean; gateFailures: number; iterations: number; maxRevisions: number; capReached: boolean }): LoopDecision {
  if (input.passed && input.gateFailures === 0) return { kind: 'done', outcome: 'passed' }
  if (input.iterations >= input.maxRevisions) return { kind: 'done', outcome: 'max_revisions' }
  if (input.capReached) return { kind: 'done', outcome: 'cost_cap' }
  return { kind: 'revise' }
}

// A claim younger than any step can live may still have a working step.
export function isClaimLive(claim: ReviewClaim | null, now: number): boolean {
  if (!claim) return false
  const at = Date.parse(claim.at)
  return Number.isFinite(at) && now - at <= DESIGN_STEP_MAX_LIFETIME_MS
}

// Notes that describe a FAILED ATTEMPT (renderer down, a timed-out render):
// a Retry drops them — the retried work re-adds them if it fails again.
export const ATTEMPT_NOTE_PREFIXES = ['Current-site render skipped:', 'The current-site render could not be re-read', 'Render skipped:'] as const

export function dropAttemptNotes(notes: string[]): string[] {
  return notes.filter((n) => !ATTEMPT_NOTE_PREFIXES.some((p) => n.startsWith(p)))
}

export const UNMEASURED_WARNING =
  'This concept was not checked for contrast, mobile overflow or hidden blocks (it could not be rendered) — check it in the live preview before publishing.'

export type RenderGate = { ok: true; warnings: string[] } | { ok: false; failures: string[] }

// Spec "hard gates before apply" (R6): the LATEST render's metrics, diffed
// against the current site's. Unmeasured ⇒ allowed with a warning.
export function applyRenderGate(review: ConceptReview | null, baseline: RenderMetrics | null): RenderGate {
  if (!review?.metrics) return { ok: true, warnings: [UNMEASURED_WARNING] }
  const failures = metricGateFailures(review.metrics, baseline)
  return failures.length > 0 ? { ok: false, failures: failures.map((f) => f.message) } : { ok: true, warnings: [] }
}

export function renderGateMessage(failures: string[]): string {
  const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : ''
  return `This concept fails the render checks, so it can’t be applied: ${failures.slice(0, 3).join(' · ')}${more}`
}
