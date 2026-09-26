// Server-only. The P4 critique loop — ONE unit of work per step invocation (a
// critique and a revision never share one: a single Opus bundle call can take
// ~2.5 min of the step's 540 s model budget):
//   render   — the concept's desktop + mobile folds + in-page metrics (no
//              model), stored as concept-{p}-r{i} (i = the revision round, 0
//              = the first design). The first render is claimed pending →
//              refining (P3's claim) and settled by a CAS on that claimed row;
//              a re-render after a revision by a CAS unit claim. Before a
//              run's first concept render, a missing current-site render (the
//              critic's context + the metrics baseline) is retried.
//   critique — ONE Opus vision call (critic.ts) → done or revise.
//   revise   — ONE Opus call (concept-reviser.ts) → a new bundle → render.
// A concept stays 'refining' for its whole loop and ends 'ready' with its
// latest valid bundle. Model units re-read the run's cost AFTER claiming,
// check the cap first, and persist spend BEFORE settling the concept. A
// failing critique / revision ends that concept's loop with a note; it never
// fails the run.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { DESIGN_MODEL } from '@/lib/content/generation-tuning'
import { parseDesignBundle } from './bundle'
import { bundleToRepoFiles } from './bundle-files'
import { buildCritiquePrompt } from './brief/critique-prompt'
import { buildRevisePrompt } from './brief/revise-prompt'
import { critiqueConcept } from './critic'
import { reviseConcept } from './concept-reviser'
import { composedThemeFromFiles } from './composed-theme'
import { distinctnessReport } from './distinctness'
import { metricGateFailures, type RenderMetrics } from './metrics'
import { loadRenderShell, renderAndStoreFolds } from './render/render-folds'
import {
  decideAfterCritique,
  dropAttemptNotes,
  endReview,
  latestCritique,
  newReview,
  parseConceptReview,
  withCritique,
  withReviewNotes,
  type ConceptReview,
  type ReviewOutcome,
  type ReviewUnit,
} from './review'
import {
  claimConceptRender,
  claimConceptUnit,
  getRun,
  listConcepts,
  settleConceptUnit,
  settleInitialRender,
  transitionRun,
  updateRunFields,
  type ConceptUnitPatch,
  type DesignConceptRow,
  type DesignRunRow,
} from './run-store'
import { gatherBriefBasics, sharedPromptArgs } from './run-gather'
import { CONCEPT_STOPPED_MID_REVIEW, hasStalledConcept, parseBaseSnapshot, parseScreenshots, usablePriors } from './run-state'
import type { RunScreenshot } from './run-types'
import { STEP_MODEL_BUDGET_MS, type StepContext, type StepOutcome } from './step-types'
import { downloadDesignImage, removeDesignPaths } from './storage'
import { readDraftThemeTexts } from './theme-snapshot'

type Db = SupabaseClient<Database>
type Now = () => number
type FoldResult = { shots: RunScreenshot[]; metrics: RenderMetrics | null; error: string | null }

const RENDER_FAILED = 'The render failed — use the live preview instead.'

export const capLoopNote = (capUsd: number): string => `Stopped refining at the $${capUsd.toFixed(2)} run cap — showing the latest version.`

// Why a revision was rejected, in short: our own validation messages, minus
// the repair guidance addressed to the model (near-duplicate errors end in
// " — change the palette direction …").
export function revisionRejectionReason(errors: string[]): string {
  return errors
    .slice(0, 3)
    .map((e) => (e.startsWith('too similar to concept') ? e.split(' — ')[0] : e))
    .join('; ')
    .slice(0, 300)
}

// After a unit: finalize the run when no concept has work left, else heartbeat.
// A concept stopped mid-loop (swept to 'error' with its bundle) fails the run
// instead of being finalized without its review — Retry resumes it.
async function afterUnit(db: Db, runId: string, unit: ReviewUnit | 'finish', conceptId: string): Promise<StepOutcome> {
  const rows = await listConcepts(db, runId)
  const remaining = rows.some((c) => c.status === 'refining' || (c.status === 'pending' && c.bundle !== null))
  if (remaining) {
    await updateRunFields(db, runId, {})
  } else if (hasStalledConcept(rows)) {
    await transitionRun(db, runId, ['refining'], { status: 'error', error: CONCEPT_STOPPED_MID_REVIEW })
    return { kind: 'failed', error: CONCEPT_STOPPED_MID_REVIEW }
  } else {
    await transitionRun(db, runId, ['refining'], { status: 'ready', stage: 'ready' })
  }
  return { kind: 'refined', unit, conceptId, remaining }
}

// A failure AFTER a model unit's concept settle landed (afterUnit's reads /
// run writes). It must reach the step route — which errors the run at once
// (WORKER_CRASHED) so Retry works — instead of the unit's catch, whose endLoop
// CAS would miss the already-settled row and no-op, stalling the run until the
// sweep.
class AfterSettleError extends Error {
  constructor(cause: unknown) {
    super('[design-run] a step failed after its concept was settled', { cause })
    this.name = 'AfterSettleError'
  }
}

async function afterSettle(db: Db, runId: string, unit: ReviewUnit | 'finish', conceptId: string): Promise<StepOutcome> {
  try {
    return await afterUnit(db, runId, unit, conceptId)
  } catch (err) {
    throw new AfterSettleError(err)
  }
}

// Absolute (idempotent) spend write: guarded, unguarded when the run moved on.
async function persistSpend(db: Db, runId: string, costUsd: number): Promise<void> {
  const moved = await transitionRun(db, runId, ['refining'], { costUsd })
  if (!moved) await updateRunFields(db, runId, { costUsd })
}

async function loadImage(db: Db, shot: RunScreenshot | undefined): Promise<Uint8Array | null> {
  if (!shot) return null
  try {
    return await downloadDesignImage(db, shot.path)
  } catch (err) {
    console.warn('[design-run] render download failed', err)
    return null
  }
}

// Reads the concept and claims `unit` on it (CAS on the row as read). null ⇒
// another step holds or changed it — the caller must not do the work.
async function claimUnit(db: Db, runId: string, conceptId: string, unit: ReviewUnit): Promise<{ row: DesignConceptRow; review: ConceptReview } | null> {
  const row = (await listConcepts(db, runId)).find((c) => c.id === conceptId)
  const review = row ? parseConceptReview(row.critique) : null
  if (!row || !review || row.status !== 'refining' || review.claim || review.next !== unit) return null
  const claimed = await claimConceptUnit(db, runId, row, unit, review)
  return claimed ? { row: claimed, review } : null
}

// The current-site render is the critic's context and the metrics baseline:
// retried here when generation couldn't make it (a stale "skipped" note is
// replaced by the retry's own outcome). Best effort — never blocks the render.
// Only before the run's FIRST concept render: a baseline appearing mid-run
// would judge later concepts against it and earlier ones without it.
async function ensureCurrentRender(db: Db, ctx: StepContext, conceptId: string): Promise<void> {
  const run = await getRun(db, ctx.sessionId, ctx.runId)
  if (!run) return
  const base = parseBaseSnapshot(run.base_snapshot)
  if (base.screenshots.some((s) => s.viewport === 'desktop')) return
  const concepts = await listConcepts(db, ctx.runId)
  const anyRendered = concepts.some((c) => c.id !== conceptId && (parseConceptReview(c.critique) !== null || parseScreenshots(c.screenshots).length > 0))
  if (anyRendered) return
  let shots = base.screenshots
  let metrics = base.metrics ?? null
  let note: string | null = null
  const theme = await readDraftThemeTexts(ctx.githubRepo)
  if (!theme.ok) {
    note = `Current-site render skipped: ${theme.error}`
  } else {
    const shell = await loadRenderShell(ctx, base.pagePath)
    if (!shell.ok) {
      note = `Current-site render skipped: ${shell.reason}`
    } else {
      const r = await renderAndStoreFolds({ db, sessionId: ctx.sessionId, runId: ctx.runId, name: 'current', shell: shell.shell, theme: composedThemeFromFiles(theme.files), metrics: true })
      shots = r.shots
      metrics = r.metrics
      if (r.error) note = `Current-site render skipped: ${r.error}`
    }
  }
  const notes = [...new Set([...dropAttemptNotes(base.notes), ...(note ? [note] : [])])]
  await transitionRun(db, ctx.runId, ['refining'], { baseSnapshot: { ...base, screenshots: shots, metrics, notes } })
}

// A concept's folds, composed exactly as the default apply writes them.
async function renderConceptFolds(db: Db, ctx: StepContext, pagePath: string, concept: DesignConceptRow): Promise<FoldResult> {
  const skip = (error: string): FoldResult => ({ shots: [], metrics: null, error })
  const parsed = parseDesignBundle(concept.bundle)
  if (!parsed.ok) return skip('The stored concept is no longer valid.')
  const theme = await readDraftThemeTexts(ctx.githubRepo)
  if (!theme.ok) return skip(theme.error)
  const { brandText, designText, overridesCss } = theme.files
  const files = bundleToRepoFiles(parsed.bundle, { brandText, designText, overridesCss }, { removeLegacy: true })
  if (!files.ok) return skip('The concept could not be prepared for rendering.')
  const shell = await loadRenderShell(ctx, pagePath)
  if (!shell.ok) return skip(shell.reason)
  const r = await renderAndStoreFolds({
    db,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    name: `concept-${concept.position}-r${concept.iterations}`,
    shell: shell.shell,
    theme: composedThemeFromFiles(files.files),
    metrics: true,
  })
  return { shots: r.shots, metrics: r.metrics, error: r.error }
}

export async function renderUnit(db: Db, ctx: StepContext, run: DesignRunRow, conceptId: string, mode: 'initial' | 'rerender'): Promise<StepOutcome> {
  let claimed: DesignConceptRow
  let review: ConceptReview
  if (mode === 'initial') {
    const row = await claimConceptRender(db, run.id, conceptId)
    if (!row) return { kind: 'noop', reason: 'render already claimed' }
    claimed = row
    review = parseConceptReview(row.critique) ?? newReview()
    try {
      await ensureCurrentRender(db, ctx, conceptId)
    } catch (err) {
      console.warn('[design-run] current-site re-render failed', err)
    }
  } else {
    const c = await claimUnit(db, run.id, conceptId, 'render')
    if (!c) return { kind: 'noop', reason: 'render already claimed' }
    claimed = c.row
    review = c.review
  }
  await transitionRun(db, run.id, ['refining'], { stage: 'render' })

  let result: FoldResult
  try {
    result = await renderConceptFolds(db, ctx, parseBaseSnapshot(run.base_snapshot).pagePath, claimed)
  } catch (err) {
    console.error('[design-run] render step failed', err)
    result = { shots: [], metrics: null, error: RENDER_FAILED }
  }

  // The concept's latest metrics live in critique.metrics (null: unmeasured).
  const iteration = claimed.iterations
  let next: ConceptReview = {
    ...review,
    claim: null,
    metrics: result.metrics,
    metricsIteration: result.metrics ? iteration : null,
    initialScreenshots: iteration === 0 ? result.shots : review.initialScreenshots,
  }
  let status: ConceptUnitPatch['status'] = 'refining'
  if (result.shots.some((s) => s.viewport === 'desktop')) {
    next = { ...next, next: 'critique' }
  } else {
    // Unrenderable ⇒ uncritiquable: the concept stays applicable (P3 rule).
    next = endReview(next, 'not_rendered', [
      `Render skipped: ${result.error ?? 'no desktop render was produced'} — this version was not critiqued; check it in the live preview.`,
    ])
    status = 'ready'
  }
  const patch: ConceptUnitPatch = { status, review: next, screenshots: result.shots, error: result.error }
  const settled = mode === 'initial' ? await settleInitialRender(db, run.id, claimed, patch) : await settleConceptUnit(db, run.id, claimed, patch)
  if (!settled) return { kind: 'noop', reason: 'the concept changed while rendering' }

  // R8c: the concept's previous render is superseded; the iteration-0 set
  // stays (BeforeAfter), and nothing just written is ever deleted (a retried
  // iteration reuses the same deterministic paths).
  const keep = new Set([...next.initialScreenshots, ...result.shots].map((s) => s.path))
  const superseded = parseScreenshots(claimed.screenshots)
    .map((s) => s.path)
    .filter((p) => !keep.has(p))
  if (superseded.length > 0) {
    try {
      await removeDesignPaths(db, superseded)
    } catch (err) {
      console.warn('[design-run] could not delete superseded renders', err)
    }
  }
  return afterUnit(db, run.id, 'render', claimed.id)
}

type ModelUnitStart =
  | { ok: true; row: DesignConceptRow; review: ConceptReview; run: DesignRunRow; priorCost: number; capUsd: number }
  | { ok: false; outcome: StepOutcome }

// Claim + re-read the run (its cost may have moved since the caller read it) +
// the stage write. A run that is no longer refining releases the claim (the
// concept keeps its next unit, so a Retry resumes it at once).
async function startModelUnit(db: Db, ctx: StepContext, runId: string, conceptId: string, unit: 'critique' | 'revise'): Promise<ModelUnitStart> {
  const c = await claimUnit(db, runId, conceptId, unit)
  if (!c) return { ok: false, outcome: { kind: 'noop', reason: `${unit} already claimed` } }
  const run = await getRun(db, ctx.sessionId, runId)
  const live = run && run.status === 'refining' ? await transitionRun(db, runId, ['refining'], { stage: unit }) : null
  if (!run || !live) {
    await settleConceptUnit(db, runId, c.row, { status: 'refining', review: c.review })
    return { ok: false, outcome: { kind: 'noop', reason: 'the run is no longer refining' } }
  }
  return { ok: true, row: c.row, review: c.review, run, priorCost: Number(run.cost_usd), capUsd: Number(run.cost_cap_usd) }
}

// Ends a concept's loop (ready, latest valid bundle kept) after a model unit.
async function endLoop(db: Db, runId: string, claimed: DesignConceptRow, unit: ReviewUnit, review: ConceptReview, outcome: ReviewOutcome, notes: string[]): Promise<StepOutcome> {
  const done = await settleConceptUnit(db, runId, claimed, { status: 'ready', review: endReview(review, outcome, notes) })
  return done ? afterSettle(db, runId, unit, claimed.id) : { kind: 'noop', reason: 'the concept changed meanwhile' }
}

export async function critiqueUnit(db: Db, ctx: StepContext, runId: string, conceptId: string, now: Now): Promise<StepOutcome> {
  const started = now()
  const s = await startModelUnit(db, ctx, runId, conceptId, 'critique')
  if (!s.ok) return s.outcome
  const { row: claimed, review, run, priorCost, capUsd } = s
  if (priorCost >= capUsd) return endLoop(db, runId, claimed, 'critique', review, 'cost_cap', [capLoopNote(capUsd)])

  let costUsd: number | undefined
  let reportedSpend: number | undefined
  try {
    const parsed = parseDesignBundle(claimed.bundle)
    if (!parsed.ok) return await endLoop(db, runId, claimed, 'critique', review, 'critic_unavailable', ['Not critiqued: the stored concept is no longer valid.'])
    const base = parseBaseSnapshot(run.base_snapshot)
    const gathered = await gatherBriefBasics(db, ctx, run, base.pagePath, { markup: false })
    if (!gathered.ok) return await endLoop(db, runId, claimed, 'critique', review, 'critic_unavailable', [`Not critiqued: ${gathered.error}`])
    const b = gathered.basics
    const shots = parseScreenshots(claimed.screenshots)
    const [currentImage, desktop, mobile] = await Promise.all([
      loadImage(db, base.screenshots.find((x) => x.viewport === 'desktop')),
      loadImage(db, shots.find((x) => x.viewport === 'desktop')),
      loadImage(db, shots.find((x) => x.viewport === 'mobile')),
    ])
    if (!desktop) return await endLoop(db, runId, claimed, 'critique', review, 'critic_unavailable', ['Not critiqued: its render could not be read.'])
    // Every other usable concept of the run (validated bundles) + the current site.
    const others = usablePriors(await listConcepts(db, runId), claimed.id)
    const gate = review.metrics ? metricGateFailures(review.metrics, base.metrics ?? null).map((f) => f.message) : []
    const result = await critiqueConcept({
      prompt: buildCritiquePrompt({
        firmName: b.firmName,
        schema: b.schema,
        designMd: b.designMd,
        paletteFreedom: b.paletteFreedom,
        caps: b.caps,
        currentImage,
        concept: { position: claimed.position, iteration: claimed.iterations, bundle: parsed.bundle },
        conceptCount: run.concept_count,
        others,
        distinctness: distinctnessReport(parsed.bundle, [
          { label: 'the current site', bundle: b.current },
          ...others.map((o) => ({ label: `concept ${o.position + 1}`, bundle: o.bundle })),
        ]),
        gateFailures: gate,
        desktop,
        mobile,
      }),
      iteration: claimed.iterations,
      paletteFreedom: b.paletteFreedom,
      costSoFarUsd: priorCost,
      costCapUsd: capUsd,
      deadline: started + STEP_MODEL_BUDGET_MS,
      attribution: { sessionId: ctx.sessionId, contentJobId: ctx.jobId, createdBy: run.created_by },
      now,
      onSpend: (usd) => {
        reportedSpend = usd
      },
    })
    costUsd = priorCost + result.costUsd
    await persistSpend(db, runId, costUsd) // BEFORE the concept is settled
    if (!result.critique) {
      return result.stoppedReason === 'cost_cap'
        ? await endLoop(db, runId, claimed, 'critique', review, 'cost_cap', [capLoopNote(capUsd)])
        : await endLoop(db, runId, claimed, 'critique', review, 'critic_unavailable', ['Not critiqued: the critique could not be completed.'])
    }
    const next = withCritique({ ...review, claim: null }, result.critique)
    const decision = decideAfterCritique({
      passed: result.critique.passed,
      gateFailures: gate.length,
      iterations: claimed.iterations,
      maxRevisions: run.max_revisions,
      capReached: costUsd >= capUsd,
    })
    if (decision.kind === 'done') {
      return await endLoop(db, runId, claimed, 'critique', next, decision.outcome, decision.outcome === 'cost_cap' ? [capLoopNote(capUsd)] : [])
    }
    const settled = await settleConceptUnit(db, runId, claimed, { status: 'refining', review: { ...next, next: 'revise' } })
    return settled ? await afterSettle(db, runId, 'critique', claimed.id) : { kind: 'noop', reason: 'the concept changed meanwhile' }
  } catch (err) {
    if (err instanceof AfterSettleError) throw err.cause // settled: the step route errors the run
    console.error('[design-run] critique failed', err)
    const spend = costUsd ?? (reportedSpend === undefined ? undefined : priorCost + reportedSpend)
    if (spend !== undefined) await persistSpend(db, runId, spend)
    return endLoop(db, runId, claimed, 'critique', review, 'critic_unavailable', ['Not critiqued: the critique step failed.'])
  }
}

export async function reviseUnit(db: Db, ctx: StepContext, runId: string, conceptId: string, now: Now): Promise<StepOutcome> {
  const started = now()
  const s = await startModelUnit(db, ctx, runId, conceptId, 'revise')
  if (!s.ok) return s.outcome
  const { row: claimed, review, run, priorCost, capUsd } = s
  if (priorCost >= capUsd) return endLoop(db, runId, claimed, 'revise', review, 'cost_cap', [capLoopNote(capUsd)])
  const round = claimed.iterations + 1

  let costUsd: number | undefined
  let reportedSpend: number | undefined
  try {
    const parsed = parseDesignBundle(claimed.bundle)
    if (!parsed.ok) return await endLoop(db, runId, claimed, 'revise', review, 'invalid_revision', ['Revision skipped: the stored concept is no longer valid.'])
    const base = parseBaseSnapshot(run.base_snapshot)
    const gathered = await gatherBriefBasics(db, ctx, run, base.pagePath, { markup: true })
    if (!gathered.ok) return await endLoop(db, runId, claimed, 'revise', review, 'invalid_revision', [`Revision skipped: ${gathered.error}`])
    const b = gathered.basics
    const shots = parseScreenshots(claimed.screenshots)
    const [desktop, mobile] = await Promise.all([
      loadImage(db, shots.find((x) => x.viewport === 'desktop')),
      loadImage(db, shots.find((x) => x.viewport === 'mobile')),
    ])
    const others = usablePriors(await listConcepts(db, runId), claimed.id)
    const gate = review.metrics ? metricGateFailures(review.metrics, base.metrics ?? null).map((f) => f.message) : []
    const result = await reviseConcept({
      prompt: buildRevisePrompt({
        ...sharedPromptArgs(b, run, base.pagePath, []),
        position: claimed.position,
        conceptCount: run.concept_count,
        round,
        bundle: parsed.bundle,
        others,
        critique: latestCritique(review),
        gateFailures: gate,
        desktop,
        mobile,
      }),
      context: {
        current: b.current,
        caps: b.caps,
        paletteFreedom: b.paletteFreedom,
        draftFiles: { brandText: b.theme.brandText, designText: b.theme.designText, overridesCss: b.theme.overridesCss },
        model: DESIGN_MODEL,
      },
      others,
      costSoFarUsd: priorCost,
      costCapUsd: capUsd,
      deadline: started + STEP_MODEL_BUDGET_MS,
      attribution: { sessionId: ctx.sessionId, contentJobId: ctx.jobId, createdBy: run.created_by },
      now,
      onSpend: (usd) => {
        reportedSpend = usd
      },
    })
    costUsd = priorCost + result.costUsd
    await persistSpend(db, runId, costUsd) // BEFORE the concept is settled
    if (!result.concept) {
      if (result.stoppedReason === 'cost_cap') return await endLoop(db, runId, claimed, 'revise', review, 'cost_cap', [capLoopNote(capUsd)])
      const why =
        result.errors.length > 0
          ? revisionRejectionReason(result.errors)
          : result.stoppedReason === 'deadline'
            ? 'it ran out of time'
            : 'there was no usable answer'
      return await endLoop(db, runId, claimed, 'revise', review, 'invalid_revision', [`Revision ${round} was not usable (${why}) — kept the previous version.`])
    }
    const nextReview = withReviewNotes(
      { ...review, claim: null, next: 'render', metrics: null, metricsIteration: null },
      [...b.notes, ...result.notes].map((n) => `Revision ${round}: ${n}`)
    )
    const settled = await settleConceptUnit(db, runId, claimed, { status: 'refining', review: nextReview, bundle: result.concept.bundle, iterations: round })
    return settled ? await afterSettle(db, runId, 'revise', claimed.id) : { kind: 'noop', reason: 'the concept changed meanwhile' }
  } catch (err) {
    if (err instanceof AfterSettleError) throw err.cause // settled: the step route errors the run
    console.error('[design-run] revise failed', err)
    const spend = costUsd ?? (reportedSpend === undefined ? undefined : priorCost + reportedSpend)
    if (spend !== undefined) await persistSpend(db, runId, spend)
    return endLoop(db, runId, claimed, 'revise', review, 'invalid_revision', ['Revision skipped: the revision step failed.'])
  }
}

// Defensive: a 'refining' concept whose review already says done.
export async function finishConceptUnit(db: Db, runId: string, conceptId: string): Promise<StepOutcome> {
  const row = (await listConcepts(db, runId)).find((c) => c.id === conceptId)
  const review = row ? parseConceptReview(row.critique) : null
  if (!row || !review || row.status !== 'refining' || review.claim) return { kind: 'noop', reason: 'nothing to finish' }
  const done = await settleConceptUnit(db, runId, row, { status: 'ready', review: { ...review, next: 'done' } })
  return done ? afterUnit(db, runId, 'finish', row.id) : { kind: 'noop', reason: 'the concept changed meanwhile' }
}
