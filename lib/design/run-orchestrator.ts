// Server-only. One unit of Design Studio run work per step invocation:
//   queued     → GENERATE: claim, gather the brief (firm, current design, page
//                markup, current-site render, captured inputs), ONE concept
//                call (+ one repair), store concepts, move to render.
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
import { buildConceptPrompt, type PromptImage } from './brief'
import { DESIGN_MD_PATH } from './brief/brand'
import { extractBlockSamples } from './brief/samples'
import { generateConcepts, type StopReason } from './concept-generator'
import { composedThemeFromFiles } from './composed-theme'
import { loadRenderShell, renderAndStoreFolds } from './render/render-folds'
import { readDraftThemeTexts } from './theme-snapshot'
import { listInputs, readSessionSchema } from './store'
import { downloadDesignImage } from './storage'
import {
  claimConceptRender,
  deleteRunConcepts,
  finishConceptRender,
  getRun,
  insertConcepts,
  listConcepts,
  transitionRun,
  updateRunFields,
  type DesignConceptRow,
  type DesignRunRow,
  type NewDesignConcept,
  type RunPatch,
} from './run-store'
import { inputCaption, inputLabel, nextAction, parseBaseSnapshot, selectRunInputs } from './run-state'
import { PALETTE_FREEDOMS, type RunStatus } from './studio-types'
import { MAX_PROMPT_IMAGES, type PaletteFreedom, type RunScreenshot } from './run-types'

type Db = ReturnType<typeof createServerClient>

export type StepContext = { sessionId: string; runId: string; jobId: string; githubRepo: string }
export type StepOutcome =
  | { kind: 'generated'; concepts: number }
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

export function shouldChain(outcome: StepOutcome): boolean {
  return outcome.kind === 'generated' || (outcome.kind === 'rendered' && outcome.remaining > 0)
}

const GENERATE_FAILED = 'Concept generation failed — press Retry.'

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

export async function runDesignStep(ctx: StepContext, now: () => number = Date.now): Promise<StepOutcome> {
  const db = createServerClient()
  const run = await getRun(db, ctx.sessionId, ctx.runId)
  if (!run) return { kind: 'noop', reason: 'run not found' }
  const action = nextAction(run, await listConcepts(db, run.id))
  switch (action.kind) {
    case 'generate':
      return generateStage(db, ctx, run.id, now)
    case 'render':
      return renderStage(db, ctx, run, action.conceptId)
    case 'finalize':
      return finalizeStage(db, run.id)
    default:
      return { kind: 'noop', reason: action.reason }
  }
}

async function generateStage(db: Db, ctx: StepContext, runId: string, now: () => number): Promise<StepOutcome> {
  const started = now()
  const run = await transitionRun(db, runId, ['queued'], { status: 'generating', stage: 'generate', error: null })
  if (!run) return { kind: 'noop', reason: 'generation already claimed' }
  // The run's cost including this generation — set as soon as the model call
  // returns, so a later failure (insert, transition) still persists the spend.
  let costUsd: number | undefined
  try {
    const base = parseBaseSnapshot(run.base_snapshot)
    const caps = capabilitiesFromJson(run.capabilities)
    const paletteFreedom = paletteFreedomOf(run)
    const notes: string[] = []

    const theme = await readDraftThemeTexts(ctx.githubRepo)
    if (!theme.ok) return failRun(db, runId, ['generating'], theme.error)
    const { brandText, designText, overridesCss } = theme.files
    // The current design's levers (its CSS region is irrelevant input here, and
    // skipping it means malformed legacy markers can't block generation).
    const current = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current design', source: 'baseline' })
    if (!current.ok) return failRun(db, runId, ['generating'], `The current design can’t be read: ${current.errors.join(' ')}`.slice(0, 500))
    await deleteRunConcepts(db, runId) // a retried generate starts clean

    // The chosen page: real markup for the brief + the current-site "before".
    const images: PromptImage[] = []
    let blockSamples = ''
    let currentShots: RunScreenshot[] = []
    const shell = await loadRenderShell(ctx, base.pagePath)
    if (shell.ok) {
      blockSamples = extractBlockSamples(shell.shell.shellHtml)
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
        images.push({
          caption: `The client's CURRENT design of ${base.pagePath} (desktop, 1440 px) — the "before" to improve on.`,
          adminText: null,
          bytes: new Uint8Array(rendered.desktopWebp),
          mediaType: 'image/webp',
        })
      }
      if (rendered.error) notes.push(`Current-site render skipped: ${rendered.error}`)
    } else {
      notes.push(`Page ${base.pagePath} could not be loaded (${shell.reason}) — generated without its markup or a current render.`)
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

    // Cancelled while we gathered the brief? Don't spend on the model.
    const fresh = await getRun(db, ctx.sessionId, runId)
    if (!fresh || fresh.status !== 'generating') return { kind: 'noop', reason: 'run was cancelled' }

    const result = await generateConcepts({
      prompt: buildConceptPrompt({
        caps,
        conceptCount: run.concept_count,
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
      conceptCount: run.concept_count,
      costSoFarUsd: Number(run.cost_usd),
      costCapUsd: Number(run.cost_cap_usd),
      deadline: started + GENERATE_BUDGET_MS,
      attribution: { sessionId: ctx.sessionId, contentJobId: ctx.jobId, createdBy: run.created_by },
      now,
    })
    notes.push(...result.notes)
    costUsd = Number(run.cost_usd) + result.costUsd // result.costUsd already includes its estimate
    const baseSnapshot = { ...base, screenshots: currentShots, notes }

    if (result.concepts.length === 0) {
      const reason = STOP_MESSAGES[result.stoppedReason ?? 'no_output']
      const detail = result.rejected[0]?.errors[0] ? ` (${result.rejected[0].errors[0].slice(0, 200)})` : ''
      return failRun(db, runId, ['generating'], `${reason}${detail}`, { costUsd, baseSnapshot })
    }

    const rows: NewDesignConcept[] = [
      ...result.concepts.map((c, i) => ({ runId, sessionId: ctx.sessionId, position: i, status: 'pending' as const, bundle: c.bundle, error: null })),
      ...result.rejected.map((r, i) => ({
        runId,
        sessionId: ctx.sessionId,
        position: result.concepts.length + i,
        status: 'rejected' as const,
        bundle: null,
        error: r.errors.join('; ').slice(0, 1000),
      })),
    ].slice(0, 3) // design_concepts.position is CHECKed 0..2
    await insertConcepts(db, rows)

    const moved = await transitionRun(db, runId, ['generating'], { status: 'refining', stage: 'render', costUsd, baseSnapshot })
    if (!moved) {
      await updateRunFields(db, runId, { costUsd })
      return { kind: 'noop', reason: 'run was cancelled' }
    }
    return { kind: 'generated', concepts: result.concepts.length }
  } catch (err) {
    console.error('[design-run] generate failed', err)
    return failRun(db, runId, ['generating'], GENERATE_FAILED, costUsd === undefined ? {} : { costUsd })
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
