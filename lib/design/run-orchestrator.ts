// Server-only. One unit of Design Studio run work per step invocation:
//   queued / generating → GENERATE ONE CONCEPT: claim the next position (an
//                insert on UNIQUE (run_id, position), so a duplicate step is a
//                no-op), gather the brief (position 0 also renders the current
//                site into base_snapshot; later positions re-read it from
//                storage), ONE concept call (+ one repair) that must differ
//                from the accepted concepts, settle the row (pending /
//                rejected). After the last position — or when the cost cap
//                stops generation — move to render (≥ 1 usable) or error.
//   refining   → RENDER one pending concept (desktop + mobile fold); finalize
//                (→ ready) inline when none remain.
//   anything else → no-op.
// Every transition is guarded (run-store), so a duplicate step call or a
// cancel mid-flight is harmless. Chaining to the next step is the caller's job
// (shouldChain + chainOrFail in the step route's after()).
import { createServerClient } from '@/lib/supabase/server'
import { DESIGN_MODEL } from '@/lib/content/generation-tuning'
import { readOptional } from './apply-bundle'
import { parseDesignBundle } from './bundle'
import { bundleFromRepoFiles, bundleToRepoFiles } from './bundle-files'
import { capabilitiesFromJson } from './capabilities'
import { buildConceptPrompt, type PriorConcept, type PromptImage } from './brief'
import { DESIGN_MD_PATH } from './brief/brand'
import { extractBlockSamples } from './brief/samples'
import { generateConcept, type GeneratedConcept, type StopReason } from './concept-generator'
import { composedThemeFromFiles } from './composed-theme'
import { loadRenderShell, renderAndStoreFolds } from './render/render-folds'
import { readDraftThemeTexts } from './theme-snapshot'
import { listInputs, readSessionSchema } from './store'
import { downloadDesignImage } from './storage'
import {
  claimConceptPosition,
  claimConceptRender,
  deleteConcepts,
  finishConceptRender,
  getRun,
  listConcepts,
  settleConceptGeneration,
  transitionRun,
  updateRunFields,
  type ConceptGenerationResult,
  type DesignConceptRow,
  type DesignRunRow,
  type RunPatch,
} from './run-store'
import { inputCaption, inputLabel, isUsableConcept, nextAction, parseBaseSnapshot, selectRunInputs } from './run-state'
import { PALETTE_FREEDOMS, type RunStatus } from './studio-types'
import { MAX_PROMPT_IMAGES, type PaletteFreedom, type RunBaseSnapshot, type RunScreenshot } from './run-types'

type Db = ReturnType<typeof createServerClient>

export type StepContext = { sessionId: string; runId: string; jobId: string; githubRepo: string }
export type StepOutcome =
  // position: the position designed this step (null: no model call — every
  // position already existed, or the cost cap was already reached).
  | { kind: 'generated'; position: number | null; next: 'generate' | 'render' }
  | { kind: 'rendered'; conceptId: string; remaining: number }
  | { kind: 'finalized' }
  | { kind: 'noop'; reason: string }
  | { kind: 'failed'; error: string }

// The step route's maxDuration is 600 s; generation must finish every model
// call by this point so the function is never killed mid-write.
export const GENERATE_BUDGET_MS = 540_000

const STOP_MESSAGES: Record<StopReason, string> = {
  cost_cap: 'The run hit its cost cap before any concept was usable.',
  deadline: 'Concept generation ran out of time — press Retry.',
  no_output: 'The model returned no usable concepts — press Retry.',
}

// Per-position rejection text (our own) when the model gave no usable answer.
const POSITION_STOP_MESSAGES: Record<Exclude<StopReason, 'cost_cap'>, string> = {
  deadline: 'Ran out of time designing this concept.',
  no_output: 'The model returned no usable concept.',
}

export function shouldChain(outcome: StepOutcome): boolean {
  return outcome.kind === 'generated' || (outcome.kind === 'rendered' && outcome.remaining > 0)
}

const GENERATE_FAILED = 'Concept generation failed — press Retry.'
const GENERATING: readonly RunStatus[] = ['generating']
const GENERATE_STATUSES: readonly RunStatus[] = ['queued', 'generating']

// Errors the run (only while it is still in `from`). Spend is never lost: when
// the guarded transition finds no row (cancelled / swept meanwhile) the cost
// is still written unguarded.
async function failRun(
  db: Db,
  runId: string,
  from: readonly RunStatus[],
  message: string,
  extra: Pick<RunPatch, 'costUsd' | 'baseSnapshot'> = {}
): Promise<StepOutcome> {
  const failed = await transitionRun(db, runId, from, { status: 'error', error: message, ...extra })
  if (!failed && extra.costUsd !== undefined) await updateRunFields(db, runId, { costUsd: extra.costUsd })
  return { kind: 'failed', error: message }
}

function firmNameFrom(brandText: string): string {
  try {
    const name = (JSON.parse(brandText) as { firm?: { name?: unknown } }).firm?.name
    return typeof name === 'string' && name.trim() ? name.trim() : 'the firm'
  } catch {
    return 'the firm'
  }
}

function paletteFreedomOf(run: DesignRunRow): PaletteFreedom {
  return (PALETTE_FREEDOMS as readonly string[]).includes(run.palette_freedom) ? (run.palette_freedom as PaletteFreedom) : 'evolve'
}

// The accepted concepts (valid stored bundles), by position.
function priorConcepts(concepts: DesignConceptRow[]): PriorConcept[] {
  return concepts
    .filter(isUsableConcept)
    .flatMap((c) => {
      const parsed = parseDesignBundle(c.bundle)
      return parsed.ok ? [{ position: c.position, bundle: parsed.bundle }] : []
    })
    .sort((a, b) => a.position - b.position)
}

const withNotes = (base: RunBaseSnapshot, notes: string[]): RunBaseSnapshot => ({ ...base, notes: [...new Set([...base.notes, ...notes])] })

const capNote = (capUsd: number, accepted: number): string =>
  `Stopped at the $${capUsd.toFixed(2)} cap after ${accepted} concept${accepted === 1 ? '' : 's'}.`

export async function runDesignStep(ctx: StepContext, now: () => number = Date.now): Promise<StepOutcome> {
  const db = createServerClient()
  const run = await getRun(db, ctx.sessionId, ctx.runId)
  if (!run) return { kind: 'noop', reason: 'run not found' }
  const concepts = await listConcepts(db, run.id)
  const action = nextAction(run, concepts)
  switch (action.kind) {
    case 'generate':
      return generateStage(db, ctx, run, concepts, action.position, now)
    case 'start-render':
      return endGeneration(db, run.id, GENERATE_STATUSES, { accepted: priorConcepts(concepts).length, position: null, capped: false })
    case 'no-concepts':
      return failRun(db, run.id, GENERATE_STATUSES, STOP_MESSAGES.no_output)
    case 'render':
      return renderStage(db, ctx, run, action.conceptId)
    case 'finalize':
      return finalizeStage(db, run.id)
    default:
      return { kind: 'noop', reason: action.reason }
  }
}

// Generation is over (last position, or the cost cap): render what exists, or
// error when nothing is usable.
async function endGeneration(
  db: Db,
  runId: string,
  from: readonly RunStatus[],
  end: { accepted: number; position: number | null; capped: boolean } & Pick<RunPatch, 'costUsd' | 'baseSnapshot'>
): Promise<StepOutcome> {
  const extra: Pick<RunPatch, 'costUsd' | 'baseSnapshot'> = {
    ...(end.costUsd !== undefined ? { costUsd: end.costUsd } : {}),
    ...(end.baseSnapshot !== undefined ? { baseSnapshot: end.baseSnapshot } : {}),
  }
  if (end.accepted === 0) return failRun(db, runId, from, STOP_MESSAGES[end.capped ? 'cost_cap' : 'no_output'], extra)
  const moved = await transitionRun(db, runId, from, { status: 'refining', stage: 'render', ...extra })
  if (!moved) {
    if (extra.costUsd !== undefined) await updateRunFields(db, runId, { costUsd: extra.costUsd })
    return { kind: 'noop', reason: 'run was cancelled' }
  }
  return { kind: 'generated', position: end.position, next: 'render' }
}

// What a finished concept call writes to its claimed row (null: release the
// claim — the cost cap stopped the call before it produced anything).
function positionResult(result: GeneratedConcept): ConceptGenerationResult | null {
  if (result.concept) return { status: 'pending', bundle: result.concept.bundle }
  if (result.errors.length > 0) return { status: 'rejected', error: result.errors.join('; ') }
  if (result.stoppedReason === 'cost_cap') return null
  return { status: 'rejected', error: POSITION_STOP_MESSAGES[result.stoppedReason ?? 'no_output'] }
}

async function generateStage(
  db: Db,
  ctx: StepContext,
  queuedOrGenerating: DesignRunRow,
  concepts: DesignConceptRow[],
  position: number,
  now: () => number
): Promise<StepOutcome> {
  const started = now()
  const runId = queuedOrGenerating.id
  let run: DesignRunRow | null = queuedOrGenerating
  if (run.status === 'queued') {
    run = await transitionRun(db, runId, ['queued'], { status: 'generating', stage: 'generate', error: null })
    if (!run) return { kind: 'noop', reason: 'generation already claimed' }
  }
  const capUsd = Number(run.cost_cap_usd)
  const priors = priorConcepts(concepts)
  let base = parseBaseSnapshot(run.base_snapshot)

  // The cap is checked before every call — including before claiming a position.
  if (Number(run.cost_usd) >= capUsd) {
    return endGeneration(db, runId, GENERATING, {
      accepted: priors.length,
      position: null,
      capped: true,
      baseSnapshot: withNotes(base, [capNote(capUsd, priors.length)]),
    })
  }

  const claim = await claimConceptPosition(db, { runId, sessionId: ctx.sessionId, position })
  if (!claim) return { kind: 'noop', reason: `concept ${position + 1} already claimed` }

  // The run's cost before this call. Re-read AFTER the claim (below): an
  // overlapping step may have paid for an earlier position since this step
  // read the run, and this step's absolute cost write must include that.
  let priorCost = Number(run.cost_usd)
  // The run's cost including this call — set as soon as the model call
  // returns, so a later failure (settle, transition) still persists the spend.
  let costUsd: number | undefined
  // The generator's latest running spend (onSpend), so spend already incurred
  // survives a throw from INSIDE generateConcept (e.g. validation).
  let reportedSpend: number | undefined
  // Fails the run, first marking this step's claim failed (best effort).
  const abort = async (message: string, extra: Pick<RunPatch, 'costUsd' | 'baseSnapshot'> = {}): Promise<StepOutcome> => {
    try {
      await settleConceptGeneration(db, claim.id, { status: 'error', error: message })
    } catch (err) {
      console.error('[design-run] could not mark the concept as failed', err)
    }
    return failRun(db, runId, GENERATING, message, extra)
  }

  try {
    const fresh = await getRun(db, ctx.sessionId, runId)
    if (!fresh) {
      await deleteConcepts(db, runId, [claim.id])
      return { kind: 'noop', reason: 'run not found' }
    }
    priorCost = Number(fresh.cost_usd)
    base = parseBaseSnapshot(fresh.base_snapshot)
    if (priorCost >= capUsd) {
      await deleteConcepts(db, runId, [claim.id])
      return endGeneration(db, runId, GENERATING, {
        accepted: priors.length,
        position: null,
        capped: true,
        baseSnapshot: withNotes(base, [capNote(capUsd, priors.length)]),
      })
    }

    const caps = capabilitiesFromJson(run.capabilities)
    const paletteFreedom = paletteFreedomOf(run)
    const notes: string[] = []

    const theme = await readDraftThemeTexts(ctx.githubRepo)
    if (!theme.ok) return abort(theme.error)
    const { brandText, designText, overridesCss } = theme.files
    // The current design's levers (its CSS region is irrelevant input here, and
    // skipping it means malformed legacy markers can't block generation).
    const current = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current design', source: 'baseline' })
    if (!current.ok) return abort(`The current design can’t be read: ${current.errors.join(' ')}`.slice(0, 500))

    // The chosen page: real markup for the brief + the current-site "before".
    // Rendered once (the first concept); later concepts re-read it from storage.
    const images: PromptImage[] = []
    let blockSamples = ''
    let currentShots = base.screenshots
    const beforeCaption = `The client's CURRENT design of ${base.pagePath} (desktop, 1440 px) — the "before" to improve on.`
    const shell = await loadRenderShell(ctx, base.pagePath)
    if (shell.ok) blockSamples = extractBlockSamples(shell.shell.shellHtml)
    else notes.push(`Page ${base.pagePath} could not be loaded (${shell.reason}) — concepts were generated without its markup.`)
    const storedBefore = base.screenshots.find((s) => s.viewport === 'desktop')
    if (storedBefore) {
      try {
        images.push({ caption: beforeCaption, adminText: null, bytes: await downloadDesignImage(db, storedBefore.path), mediaType: 'image/webp' })
      } catch (err) {
        console.warn('[design-run] current-site render download failed', err)
        notes.push(`The current-site render could not be re-read — concept ${position + 1} was designed without it.`)
      }
    } else if (position === 0 && shell.ok) {
      const rendered = await renderAndStoreFolds({
        db,
        sessionId: ctx.sessionId,
        runId,
        name: 'current',
        shell: shell.shell,
        theme: composedThemeFromFiles({ designText, themeCss: theme.files.themeCss, overridesCss }),
      })
      currentShots = rendered.shots
      if (rendered.desktopWebp) {
        images.push({ caption: beforeCaption, adminText: null, bytes: new Uint8Array(rendered.desktopWebp), mediaType: 'image/webp' })
      }
      if (rendered.error) notes.push(`Current-site render skipped: ${rendered.error}`)
    }

    const { usable, skipped } = selectRunInputs(await listInputs(db, ctx.sessionId), run.input_ids)
    for (const s of skipped) notes.push(`Input skipped — ${s.label}: ${s.reason}`)
    for (const row of usable) {
      if (images.length >= MAX_PROMPT_IMAGES) {
        notes.push(`Input skipped — ${inputLabel(row)}: the image limit was reached`)
        continue
      }
      try {
        const adminText = [row.label ? `Label: ${row.label}` : '', row.notes ? `Notes: ${row.notes}` : ''].filter(Boolean).join('\n')
        images.push({ caption: inputCaption(row), adminText: adminText || null, bytes: await downloadDesignImage(db, row.storage_path), mediaType: 'image/webp' })
      } catch (err) {
        console.warn('[design-run] input image download failed', err)
        notes.push(`Input skipped — ${inputLabel(row)}: its image could not be read`)
      }
    }

    const [schema, designMd] = await Promise.all([readSessionSchema(db, ctx.sessionId), readOptional(ctx.githubRepo, DESIGN_MD_PATH)])

    // Persist the gather (the current render's paths + notes) before spending,
    // so later concepts and a retry reuse it. The guarded write doubles as the
    // cancel check: cancelled meanwhile ⇒ release the claim, no model call.
    let snapshot = withNotes({ ...base, screenshots: currentShots }, notes)
    const live = await transitionRun(db, runId, GENERATING, { baseSnapshot: snapshot })
    if (!live) {
      await deleteConcepts(db, runId, [claim.id])
      return { kind: 'noop', reason: 'run was cancelled' }
    }

    const result = await generateConcept({
      prompt: buildConceptPrompt({
        caps,
        conceptCount: run.concept_count,
        position,
        priors,
        paletteFreedom,
        current: current.bundle,
        firmName: firmNameFrom(brandText),
        schema,
        designMd: designMd?.content ?? null,
        adminBrief: run.admin_brief,
        images,
        blockSamples,
        pagePath: base.pagePath,
      }),
      context: { current: current.bundle, caps, paletteFreedom, draftFiles: { brandText, designText, overridesCss }, model: DESIGN_MODEL },
      priors,
      costSoFarUsd: priorCost,
      costCapUsd: capUsd,
      deadline: started + GENERATE_BUDGET_MS,
      attribution: { sessionId: ctx.sessionId, contentJobId: ctx.jobId, createdBy: run.created_by },
      now,
      onSpend: (usd) => {
        reportedSpend = usd
      },
    })
    costUsd = priorCost + result.costUsd // result.costUsd already includes its estimate

    const accepted = priors.length + (result.concept ? 1 : 0)
    const capped = result.stoppedReason === 'cost_cap' || costUsd >= capUsd
    const last = position >= run.concept_count - 1
    const stoppedByCap = result.stoppedReason === 'cost_cap' || (capped && !last)
    snapshot = withNotes(snapshot, stoppedByCap ? [...result.notes, capNote(capUsd, accepted)] : result.notes)

    // Persist the spend (guarded; unguarded when cancelled) BEFORE settling the
    // concept row, so a kill in between never loses what this call cost.
    const persisted = await transitionRun(db, runId, GENERATING, { costUsd, baseSnapshot: snapshot })
    if (!persisted) await updateRunFields(db, runId, { costUsd })

    const settled = positionResult(result)
    if (settled) await settleConceptGeneration(db, claim.id, settled)
    else await deleteConcepts(db, runId, [claim.id])

    if (!persisted) return { kind: 'noop', reason: 'run was cancelled' }
    if (last || capped) return endGeneration(db, runId, GENERATING, { accepted, position, capped, costUsd, baseSnapshot: snapshot })
    return { kind: 'generated', position, next: 'generate' }
  } catch (err) {
    console.error('[design-run] generate failed', err)
    // Absolute (idempotent) write: prior run cost + this call's spend.
    const spend = costUsd ?? (reportedSpend === undefined ? undefined : priorCost + reportedSpend)
    return abort(GENERATE_FAILED, spend === undefined ? {} : { costUsd: spend })
  }
}

async function renderStage(db: Db, ctx: StepContext, run: DesignRunRow, conceptId: string): Promise<StepOutcome> {
  const concept = await claimConceptRender(db, run.id, conceptId)
  if (!concept) return { kind: 'noop', reason: 'render already claimed' }
  let result: ConceptRender
  try {
    result = await renderConcept(db, ctx, run, concept)
  } catch (err) {
    console.error('[design-run] render step failed', err)
    result = { screenshots: [], error: 'The render failed — use the live preview instead.' }
  }
  await finishConceptRender(db, concept.id, result)

  const remaining = (await listConcepts(db, run.id)).filter((c) => c.status === 'pending' && c.bundle !== null).length
  if (remaining === 0) await finalizeStage(db, run.id)
  else await updateRunFields(db, run.id, {}) // heartbeat for the sweep
  return { kind: 'rendered', conceptId: concept.id, remaining }
}

type ConceptRender = { screenshots: RunScreenshot[]; error: string | null }

// A concept whose render can't happen stays applicable: no shots + a note.
async function renderConcept(db: Db, ctx: StepContext, run: DesignRunRow, concept: DesignConceptRow): Promise<ConceptRender> {
  const skip = (error: string): ConceptRender => ({ screenshots: [], error })
  const parsed = parseDesignBundle(concept.bundle)
  if (!parsed.ok) return skip('The stored concept is no longer valid.')
  const theme = await readDraftThemeTexts(ctx.githubRepo)
  if (!theme.ok) return skip(theme.error)
  const { brandText, designText, overridesCss } = theme.files
  // removeLegacy: preview what the default apply writes.
  const files = bundleToRepoFiles(parsed.bundle, { brandText, designText, overridesCss }, { removeLegacy: true })
  if (!files.ok) return skip('The concept could not be prepared for rendering.')
  const shell = await loadRenderShell(ctx, parseBaseSnapshot(run.base_snapshot).pagePath)
  if (!shell.ok) return skip(`Render skipped: ${shell.reason}`)
  const r = await renderAndStoreFolds({
    db,
    sessionId: ctx.sessionId,
    runId: run.id,
    name: `concept-${concept.position}`,
    shell: shell.shell,
    theme: composedThemeFromFiles(files.files),
  })
  return { screenshots: r.shots, error: r.error }
}

async function finalizeStage(db: Db, runId: string): Promise<StepOutcome> {
  const done = await transitionRun(db, runId, ['refining'], { status: 'ready', stage: 'ready' })
  return done ? { kind: 'finalized' } : { kind: 'noop', reason: 'run already finalized' }
}
