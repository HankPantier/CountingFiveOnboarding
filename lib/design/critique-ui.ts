// Pure + client-safe helpers behind CritiqueView / BeforeAfter / the loop
// status labels (components are not covered by vitest, so their logic lives
// here). Token classes only.
import { RUBRIC_KEYS, RUBRIC_LABELS, minScoreFor, type CritiqueRecord, type RubricKey } from './critique'
import type { ReviewOutcome } from './review'
import type { ConceptReviewDto, DesignConceptDto, DesignRunDto, ScreenshotDto } from './run-types'

export type Tone = 'success' | 'warning' | 'error' | 'neutral'
export type ScoreRow = { key: RubricKey; label: string; score: number; pct: number; tone: Tone; reason: string }

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning-strong',
  error: 'text-error',
  neutral: 'text-text-secondary',
}
export const TONE_CHIP: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning-strong',
  error: 'border-error/30 bg-error/10 text-error',
  neutral: 'border-border-default bg-surface-subtle text-text-secondary',
}
export const TONE_BAR: Record<Tone, string> = { success: 'bg-success', warning: 'bg-warning', error: 'bg-error', neutral: 'bg-border-default' }

export function scoreRows(c: CritiqueRecord): ScoreRow[] {
  return RUBRIC_KEYS.map((key) => {
    const score = c.scores[key]
    const bar = minScoreFor(key)
    const tone: Tone = score < bar ? 'error' : score > bar || score >= 4 ? 'success' : 'warning'
    return { key, label: RUBRIC_LABELS[key], score, pct: Math.round((score / 5) * 100), tone, reason: c.reasons[key] }
  })
}

export const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  passed: 'Passed review',
  max_revisions: 'Revision limit reached',
  cost_cap: 'Stopped at the cost cap',
  invalid_revision: 'Kept the last good version',
  critic_unavailable: 'Not critiqued',
  not_rendered: 'Not rendered',
}

export function critiqueChip(review: ConceptReviewDto | null): { label: string; tone: Tone } | null {
  if (!review) return null
  const n = review.gateFailures.length
  if (n > 0) return { label: `Fails ${n} render check${n === 1 ? '' : 's'}`, tone: 'error' }
  if (review.latest) {
    const mean = review.latest.mean.toFixed(1)
    return review.latest.passed ? { label: `Passed review · ${mean}`, tone: 'success' } : { label: `Below the bar · ${mean}`, tone: 'warning' }
  }
  return review.outcome ? { label: OUTCOME_LABELS[review.outcome], tone: 'neutral' } : null
}

const BASE_LABELS: Record<DesignConceptDto['status'], string> = {
  pending: 'Waiting',
  generating: 'Generating',
  refining: 'Rendering…',
  ready: 'Ready',
  rejected: 'Rejected',
  error: 'Failed',
}

type LoopView = Pick<DesignConceptDto, 'status' | 'iterations' | 'review'>

function loopUnit(c: LoopView): 'render' | 'critique' | 'revise' {
  const u = c.review?.activeUnit ?? c.review?.next
  return u === 'critique' || u === 'revise' ? u : 'render'
}

export function conceptStatusLabel(c: LoopView, maxRevisions: number): string {
  if (c.status !== 'refining') return BASE_LABELS[c.status]
  const unit = loopUnit(c)
  if (unit === 'critique') return 'Critiquing…'
  if (unit === 'revise') return `Revising (round ${c.iterations + 1} of ${maxRevisions})…`
  return c.iterations > 0 ? `Rendering revision ${c.iterations}…` : 'Rendering…'
}

export function refineStatusLabel(run: Pick<DesignRunDto, 'concepts' | 'maxRevisions'>): string | null {
  const c = [...run.concepts].sort((a, b) => a.position - b.position).find((x) => x.status === 'refining')
  if (!c) return null
  const k = c.position + 1
  const unit = loopUnit(c)
  if (unit === 'critique') return `Critiquing concept ${k}…`
  if (unit === 'revise') return `Revising concept ${k} (round ${c.iterations + 1} of ${run.maxRevisions})…`
  return c.iterations > 0 ? `Rendering concept ${k} (revision ${c.iterations})…` : `Rendering concept ${k}…`
}

export function revisionsLabel(iterations: number, maxRevisions: number): string {
  return iterations === 0 ? 'No revisions' : `${iterations} of ${maxRevisions} revision${maxRevisions === 1 ? '' : 's'}`
}

export function beforeAfterShots(c: Pick<DesignConceptDto, 'iterations' | 'screenshots' | 'review'>): { before: ScreenshotDto[]; after: ScreenshotDto[] } | null {
  if (c.iterations === 0 || !c.review || c.review.initialScreenshots.length === 0 || c.screenshots.length === 0) return null
  return { before: c.review.initialScreenshots, after: c.screenshots }
}
