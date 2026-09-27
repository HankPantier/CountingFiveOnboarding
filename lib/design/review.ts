// Pure + client-safe. One concept's critique-loop state, stored in
// design_concepts.critique (jsonb — migration 078 has no dedicated columns):
// the next unit, the live claim, the latest render's metrics (null = the
// latest bundle is unmeasured), the iteration-0 screenshots (BeforeAfter's
// "before"), the last 3 critiques, how the loop ended, and its notes — plus
// the BEST evaluated iteration so far (bundle, renders, metrics, critique), so
// a loop that ends on a worse revision keeps the better one (WS-B). Plus the
// loop decision, notes scoping for Retry, and the apply render gate.
import { isPlainObject } from './input-validation'
import { parseCritiqueRecord, type CritiqueRecord } from './critique'
import { metricGateFailures, parseRenderMetrics, type RenderMetrics } from './metrics'
import { parseScreenshots } from './screenshots'
import { DESIGN_STEP_MAX_LIFETIME_MS, type RunScreenshot, type RunViewport } from './run-types'

export const REVIEW_UNITS = ['render', 'critique', 'revise'] as const
export type ReviewUnit = (typeof REVIEW_UNITS)[number]
export type ReviewNext = ReviewUnit | 'done'
export const REVIEW_OUTCOMES = ['passed', 'max_revisions', 'cost_cap', 'invalid_revision', 'critic_unavailable', 'not_rendered'] as const
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number]
export const MAX_REVIEW_NOTES = 12
export const MAX_STORED_CRITIQUES = 3
// A render whose live-site fetch got a transient 5xx (Vercel's 508 deep in a
// step chain) is released and retried from a fresh chain this many times
// before the concept ends not_rendered like any other render failure.
export const MAX_RENDER_RETRIES = 2

export type ReviewClaim = { unit: ReviewUnit; at: string }

// One EVALUATED iteration: critiqued, or skipped by a hard render gate
// (critique null — the page overflowed, so the critic never saw it). The
// bundle is the stored (validated) concept JSON, re-parsed before any restore.
export type IterationSnapshot = {
  iteration: number
  bundle: unknown
  screenshots: RunScreenshot[]
  metrics: RenderMetrics | null
  critique: CritiqueRecord | null
  gateFailures: number
}

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
  // Transient render failures of the CURRENT version so far (absent = 0);
  // cleared by a render that settles and by a revision (a new version).
  renderRetries?: number
  // The best evaluated iteration so far (see iterationBeats). Absent until the
  // first critique / gate skip.
  best?: IterationSnapshot
  // Revisions this concept actually went through (each one a paid model call).
  // Kept apart from the row's `iterations`, which a best-iteration fallback
  // rewinds to the kept iteration. Absent on reviews written before it existed
  // (revisionsUsedOf derives a floor for those).
  revisionsUsed?: number
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
    ...(typeof value.renderRetries === 'number' && Number.isInteger(value.renderRetries) && value.renderRetries > 0
      ? { renderRetries: Math.min(value.renderRetries, MAX_RENDER_RETRIES) }
      : {}),
    ...(() => {
      const best = parseIterationSnapshot(value.best)
      return best ? { best } : {}
    })(),
    ...(nonNegInt(value.revisionsUsed) ? { revisionsUsed: value.revisionsUsed } : {}),
  }
}

/**
 * How many revisions a concept really used. `iterations` (the row column) is
 * the version it is ON, which a best-iteration fallback rewinds; the review's
 * revisionsUsed counter is not. For a review from before the counter, the
 * highest iteration the review ever recorded is the floor.
 */
export function revisionsUsedOf(review: ConceptReview | null, iterations: number): number {
  if (!review) return iterations
  if (review.revisionsUsed !== undefined) return Math.max(review.revisionsUsed, iterations)
  const seen = [
    iterations,
    review.metricsIteration ?? 0,
    review.best?.iteration ?? 0,
    ...review.critiques.map((c) => c.iteration),
  ]
  return Math.max(...seen)
}

const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export function parseIterationSnapshot(value: unknown): IterationSnapshot | null {
  if (!isPlainObject(value) || !nonNegInt(value.iteration) || !nonNegInt(value.gateFailures) || !isPlainObject(value.bundle)) return null
  const critique = value.critique === null ? null : parseCritiqueRecord(value.critique)
  if (value.critique !== null && !critique) return null
  return {
    iteration: value.iteration,
    bundle: value.bundle,
    screenshots: parseScreenshots(value.screenshots),
    metrics: parseRenderMetrics(value.metrics),
    critique,
    gateFailures: value.gateFailures,
  }
}

// Rank order (WS-B, R2 I4): appliable (no new render-check failure) first,
// then a critic pass, then the rubric mean, then craft. An uncritiqued (gate-
// skipped) iteration ranks below every critiqued one of the same gate state.
function rankKey(s: IterationSnapshot): number[] {
  return [s.gateFailures === 0 ? 1 : 0, s.critique?.passed ? 1 : 0, s.critique ? s.critique.mean : -1, s.critique ? s.critique.scores.craft : -1]
}

// True when `a` is STRICTLY better than `b` (ties go to the newer iteration —
// it is what the loop already holds, and it addressed the last critique).
export function iterationBeats(a: IterationSnapshot, b: IterationSnapshot): boolean {
  const ka = rankKey(a)
  const kb = rankKey(b)
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i]
  }
  return false
}

// Records an evaluated iteration: it becomes `best` unless the stored best
// strictly beats it.
export function withEvaluatedIteration(review: ConceptReview, snap: IterationSnapshot): ConceptReview {
  const keep = review.best && review.best.iteration !== snap.iteration && iterationBeats(review.best, snap)
  return { ...review, best: keep ? review.best : snap }
}

// The earlier iteration a finished loop should fall back to, or null to keep
// the current one. `evaluated`: the current iteration was critiqued (or gate-
// skipped) — then any different stored best has strictly beaten it. When it
// was NOT evaluated (the critic was unavailable, or the cap stopped the loop
// before its critique), only a KNOWN render-check failure of the current
// version (currentGateFailures > 0) against an appliable best triggers the
// fallback — an unjudged version is otherwise kept.
export function iterationToRestore(review: ConceptReview, current: { iteration: number; evaluated: boolean; gateFailures: number }): IterationSnapshot | null {
  const best = review.best
  if (!best || best.iteration === current.iteration) return null
  if (current.evaluated) return best
  return current.gateFailures > 0 && best.gateFailures === 0 ? best : null
}

const iterationLabel = (i: number): string => (i === 0 ? 'the first design' : `revision ${i}`)

function snapshotSummary(s: IterationSnapshot): string {
  const score = s.critique ? `mean ${s.critique.mean.toFixed(2)}, craft ${s.critique.scores.craft}` : 'not critiqued'
  const gate = s.gateFailures === 0 ? 'passes the render checks' : `${s.gateFailures} render-check failure${s.gateFailures === 1 ? '' : 's'}`
  return `${score}; ${gate}`
}

// The note a restore adds to the concept.
export function keptIterationNote(kept: IterationSnapshot, currentIteration: number): string {
  return `Kept ${iterationLabel(kept.iteration)} (${snapshotSummary(kept)}) — ${iterationLabel(currentIteration)} ranked lower (render checks first, then the critique).`
}

// The critique of the iteration the concept now holds: the stored critique
// for it, else the best snapshot's (the list keeps only the last 3), else the
// latest (a revision not yet critiqued shows the one it answers).
export function critiqueForIteration(review: Pick<ConceptReview, 'critiques' | 'best'>, iteration: number): CritiqueRecord | null {
  const own = [...review.critiques].reverse().find((c) => c.iteration === iteration)
  if (own) return own
  if (review.best?.iteration === iteration && review.best.critique) return review.best.critique
  return review.critiques.at(-1) ?? null
}

// The review without its transient-render retry count (a settled render, or a
// revision that starts a new version).
export function withoutRenderRetries(review: ConceptReview): ConceptReview {
  const { renderRetries: _retries, ...rest } = review
  return rest
}

// Whether a render that failed with this transient flag should be released
// for a fresh-chain retry instead of ending the loop as not_rendered.
export function shouldRetryRender(review: Pick<ConceptReview, 'renderRetries'>, retryable: boolean): boolean {
  return retryable && (review.renderRetries ?? 0) < MAX_RENDER_RETRIES
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

const MEASURED_VIEWPORTS: readonly RunViewport[] = ['desktop', 'mobile']
// Lower-case viewport names for warnings (shared with the design chat's gate).
export const RUN_VIEWPORT_NAME: Record<RunViewport, string> = { desktop: 'desktop (1440)', mobile: 'mobile (390)' }

// The viewports a render's metrics do NOT cover (a render that failed part-way
// keeps the viewports it measured) — all of them when unmeasured.
export function unmeasuredViewports(metrics: RenderMetrics | null): RunViewport[] {
  const have = new Set((metrics?.viewports ?? []).map((v) => v.viewport))
  return MEASURED_VIEWPORTS.filter((v) => !have.has(v))
}

export const unmeasuredViewportWarning = (viewport: RunViewport): string =>
  `This concept’s ${RUN_VIEWPORT_NAME[viewport]} render was not checked for contrast, overflow or hidden blocks (it could not be measured) — check it in the live preview before publishing.`

export type RenderGate = { ok: true; warnings: string[] } | { ok: false; failures: string[] }

// Spec "hard gates before apply" (R6): the LATEST render's metrics, diffed
// against the current site's. Unmeasured ⇒ allowed with a warning; a viewport
// the render did not measure ⇒ allowed with a warning naming that viewport
// (its checks never ran, so their absence is not a pass).
export function applyRenderGate(review: ConceptReview | null, baseline: RenderMetrics | null): RenderGate {
  return metricsRenderGate(review?.metrics ?? null, baseline, { unmeasured: UNMEASURED_WARNING, unmeasuredViewport: unmeasuredViewportWarning })
}

// The gate itself, over bare metrics, with caller wording for the warnings —
// the concept apply gate above and the design chat's commit gate
// (chat-gate.ts) both run exactly this.
export function metricsRenderGate(
  metrics: RenderMetrics | null,
  baseline: RenderMetrics | null,
  wording: { unmeasured: string; unmeasuredViewport: (viewport: RunViewport) => string }
): RenderGate {
  if (!metrics) return { ok: true, warnings: [wording.unmeasured] }
  const failures = metricGateFailures(metrics, baseline)
  if (failures.length > 0) return { ok: false, failures: failures.map((f) => f.message) }
  return { ok: true, warnings: unmeasuredViewports(metrics).map(wording.unmeasuredViewport) }
}

// What the UI shows before apply: the gate's warnings (none while it refuses).
export function renderGateWarnings(review: ConceptReview | null, baseline: RenderMetrics | null): string[] {
  const gate = applyRenderGate(review, baseline)
  return gate.ok ? gate.warnings : []
}

export function renderGateMessage(failures: string[]): string {
  const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : ''
  return `This concept fails the render checks, so it can’t be applied: ${failures.slice(0, 3).join(' · ')}${more}`
}
