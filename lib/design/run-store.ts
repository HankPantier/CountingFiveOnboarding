// Server-only. Typed access to design_runs / design_concepts (migration 078).
// Runs are read scoped by session_id; every state change is a GUARDED update
// (only from the expected statuses) so duplicate step calls and cancels are
// race-safe. Throws on DB errors (callers map to internalError / run error).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import type { DesignBundle } from './bundle'
import type { RunStatus } from './studio-types'
import { DEFAULT_RUN_COST_CAP_USD, type DesignCapabilities, type PaletteFreedom, type RunBaseSnapshot, type RunScreenshot, type RunStage } from './run-types'
import { dropAttemptNotes, parseConceptReview, type ConceptReview, type ReviewUnit } from './review'

type Db = SupabaseClient<Database>
export type DesignRunRow = Tables<'design_runs'>
export type DesignConceptRow = Tables<'design_concepts'>

const UNIQUE_VIOLATION = '23505'

export class ActiveRunExistsError extends Error {
  constructor(sessionId: string) {
    super(`A design run is already active for session ${sessionId}`)
    this.name = 'ActiveRunExistsError'
  }
}

function storeError(context: string, error: { message: string } | null): Error {
  return new Error(`[design-run-store] ${context}: ${error?.message ?? 'no data returned'}`)
}

const stamp = () => new Date().toISOString()

export type NewDesignRun = {
  sessionId: string
  createdBy: string | null
  paletteFreedom: PaletteFreedom
  adminBrief: string | null
  conceptCount: number
  inputIds: string[]
  capabilities: DesignCapabilities
  baseSnapshot: RunBaseSnapshot
}

export async function createRun(db: Db, run: NewDesignRun): Promise<DesignRunRow> {
  const row: TablesInsert<'design_runs'> = {
    session_id: run.sessionId,
    status: 'queued',
    stage: 'generate',
    palette_freedom: run.paletteFreedom,
    admin_brief: run.adminBrief,
    concept_count: run.conceptCount,
    input_ids: run.inputIds,
    capabilities: asJson(run.capabilities),
    base_snapshot: asJson(run.baseSnapshot),
    cost_cap_usd: DEFAULT_RUN_COST_CAP_USD,
    created_by: run.createdBy,
  }
  const { data, error } = await db.from('design_runs').insert(row).select('*').single()
  if (error?.code === UNIQUE_VIOLATION) throw new ActiveRunExistsError(run.sessionId)
  if (error || !data) throw storeError('createRun', error)
  return data
}

export async function getRun(db: Db, sessionId: string, runId: string): Promise<DesignRunRow | null> {
  const { data, error } = await db.from('design_runs').select('*').eq('id', runId).eq('session_id', sessionId).maybeSingle()
  if (error) throw storeError('getRun', error)
  return data
}

export async function latestRun(db: Db, sessionId: string): Promise<DesignRunRow | null> {
  const { data, error } = await db
    .from('design_runs')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw storeError('latestRun', error)
  return data
}

export async function listConcepts(db: Db, runId: string): Promise<DesignConceptRow[]> {
  const { data, error } = await db.from('design_concepts').select('*').eq('run_id', runId).order('position', { ascending: true })
  if (error) throw storeError('listConcepts', error)
  return data ?? []
}

// The Studio's run poll (every 4 s while a run is active) needs everything
// the DTO renders but never `initial_bundle` (only the reviser reads it).
const CONCEPT_VIEW_COLUMNS =
  'id, run_id, session_id, position, status, error, bundle, critique, screenshots, iterations, cost_usd, created_at, updated_at'
export type DesignConceptViewRow = Omit<DesignConceptRow, 'initial_bundle'>

export async function listConceptsForView(db: Db, runId: string): Promise<DesignConceptViewRow[]> {
  const { data, error } = await db
    .from('design_concepts')
    .select(CONCEPT_VIEW_COLUMNS)
    .eq('run_id', runId)
    .order('position', { ascending: true })
  if (error) throw storeError('listConceptsForView', error)
  return data ?? []
}

export async function getConcept(db: Db, sessionId: string, conceptId: string): Promise<DesignConceptRow | null> {
  const { data, error } = await db
    .from('design_concepts')
    .select('*')
    .eq('id', conceptId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw storeError('getConcept', error)
  return data
}

export type RunPatch = {
  status?: RunStatus
  stage?: RunStage | null
  error?: string | null
  costUsd?: number
  baseSnapshot?: RunBaseSnapshot
}

function toRunUpdate(patch: RunPatch): TablesUpdate<'design_runs'> {
  const update: TablesUpdate<'design_runs'> = { updated_at: stamp() }
  if (patch.status !== undefined) update.status = patch.status
  if (patch.stage !== undefined) update.stage = patch.stage
  if (patch.error !== undefined) update.error = patch.error
  if (patch.costUsd !== undefined) update.cost_usd = Math.round(patch.costUsd * 10_000) / 10_000
  if (patch.baseSnapshot !== undefined) update.base_snapshot = asJson(patch.baseSnapshot)
  return update
}

// Guarded transition: applies only while the run is in one of `from`. null =
// the run moved on (another worker claimed it, it was cancelled, or swept).
export async function transitionRun(
  db: Db,
  runId: string,
  from: readonly RunStatus[],
  patch: RunPatch
): Promise<DesignRunRow | null> {
  const { data, error } = await db
    .from('design_runs')
    .update(toRunUpdate(patch))
    .eq('id', runId)
    .in('status', [...from])
    .select('*')
    .maybeSingle()
  // Moving an errored run back to an active status can collide with the
  // one-active-run partial unique index.
  if (error?.code === UNIQUE_VIOLATION) throw new ActiveRunExistsError(runId)
  if (error) throw storeError('transitionRun', error)
  return data
}

// Unguarded field write (cost on a cancelled run, an updated_at heartbeat).
export async function updateRunFields(db: Db, runId: string, patch: RunPatch): Promise<void> {
  const { error } = await db.from('design_runs').update(toRunUpdate(patch)).eq('id', runId)
  if (error) throw storeError('updateRunFields', error)
}

// Deletes these concepts of this run (a retry regenerating a failed position,
// or a generation claim released because nothing was generated).
export async function deleteConcepts(db: Db, runId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await db.from('design_concepts').delete().eq('run_id', runId).in('id', ids)
  if (error) throw storeError('deleteConcepts', error)
}

// Claims a position for generation by inserting its row as 'generating'. The
// UNIQUE (run_id, position) constraint makes this atomic: a duplicate step
// for the same position gets null and must not call the model.
export async function claimConceptPosition(
  db: Db,
  claim: { runId: string; sessionId: string; position: number }
): Promise<DesignConceptRow | null> {
  const row: TablesInsert<'design_concepts'> = {
    run_id: claim.runId,
    session_id: claim.sessionId,
    position: claim.position,
    status: 'generating',
    bundle: null,
    initial_bundle: null,
    error: null,
  }
  const { data, error } = await db.from('design_concepts').insert(row).select('*').single()
  if (error?.code === UNIQUE_VIOLATION) return null
  if (error || !data) throw storeError('claimConceptPosition', error)
  return data
}

export type ConceptGenerationResult =
  | { status: 'pending'; bundle: DesignBundle }
  | { status: 'rejected' | 'error'; error: string }

const MAX_CONCEPT_ERROR_CHARS = 1000

// Finalizes a claimed position (only while it is still 'generating').
export async function settleConceptGeneration(
  db: Db,
  conceptId: string,
  result: ConceptGenerationResult
): Promise<DesignConceptRow | null> {
  const update: TablesUpdate<'design_concepts'> =
    result.status === 'pending'
      ? { status: 'pending', bundle: asJson(result.bundle), initial_bundle: asJson(result.bundle), error: null, updated_at: stamp() }
      : { status: result.status, bundle: null, error: result.error.slice(0, MAX_CONCEPT_ERROR_CHARS), updated_at: stamp() }
  const { data, error } = await db
    .from('design_concepts')
    .update(update)
    .eq('id', conceptId)
    .eq('status', 'generating')
    .select('*')
    .maybeSingle()
  if (error) throw storeError('settleConceptGeneration', error)
  return data
}

export async function claimConceptRender(db: Db, runId: string, conceptId: string): Promise<DesignConceptRow | null> {
  const { data, error } = await db
    .from('design_concepts')
    .update({ status: 'refining', error: null, updated_at: stamp() })
    .eq('id', conceptId)
    .eq('run_id', runId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()
  if (error) throw storeError('claimConceptRender', error)
  return data
}

// Retry: concepts without a loop review restart their first render (pending).
// Each write is a CAS on the row exactly as the Retry read it, so a Retry that
// lost the race to a concurrent one (whose steps may already be working on
// these rows) changes nothing. Returns how many rows were reset.
export async function resetConcepts(db: Db, runId: string, rows: Pick<DesignConceptRow, 'id' | 'updated_at'>[]): Promise<number> {
  let reset = 0
  for (const row of rows) {
    const { data, error } = await db
      .from('design_concepts')
      .update({ status: 'pending', error: null, updated_at: stampAfter(row.updated_at) })
      .eq('id', row.id)
      .eq('run_id', runId)
      .eq('updated_at', row.updated_at)
      .select('id')
    if (error) throw storeError('resetConcepts', error)
    reset += data?.length ?? 0
  }
  return reset
}

export async function markRunApplied(db: Db, runId: string): Promise<void> {
  const { error } = await db
    .from('design_runs')
    .update({ status: 'applied', stage: 'ready', updated_at: stamp() })
    .eq('id', runId)
    .eq('status', 'ready')
  if (error) throw storeError('markRunApplied', error)
}

export type ConceptUnitPatch = {
  status: 'refining' | 'ready'
  review: ConceptReview
  bundle?: DesignBundle
  iterations?: number
  screenshots?: RunScreenshot[]
  error?: string | null
}

function unitUpdate(patch: ConceptUnitPatch, at: string): TablesUpdate<'design_concepts'> {
  const update: TablesUpdate<'design_concepts'> = { status: patch.status, critique: asJson({ ...patch.review, claim: null }), updated_at: at }
  if (patch.bundle !== undefined) update.bundle = asJson(patch.bundle)
  if (patch.iterations !== undefined) update.iterations = patch.iterations
  if (patch.screenshots !== undefined) update.screenshots = asJson(patch.screenshots)
  if (patch.error !== undefined) update.error = patch.error === null ? null : patch.error.slice(0, MAX_CONCEPT_ERROR_CHARS)
  return update
}

// A stamp strictly later than `after`, so a CAS on updated_at can never be
// satisfied twice by the same value (ms clock ties, clock skew).
function stampAfter(after: string): string {
  const prev = Date.parse(after)
  return new Date(Number.isFinite(prev) ? Math.max(Date.now(), prev + 1) : Date.now()).toISOString()
}

// Claims one critique-loop unit (critique / revise / re-render) of a concept
// already in its loop: a compare-and-set on the row exactly as the caller
// read it. null ⇒ another step claimed or changed it (or it was swept) — the
// caller must not call the model.
export async function claimConceptUnit(
  db: Db,
  runId: string,
  row: Pick<DesignConceptRow, 'id' | 'updated_at'>,
  unit: ReviewUnit,
  review: ConceptReview
): Promise<DesignConceptRow | null> {
  const at = stampAfter(row.updated_at)
  const { data, error } = await db
    .from('design_concepts')
    .update({ critique: asJson({ ...review, claim: { unit, at } }), updated_at: at })
    .eq('id', row.id)
    .eq('run_id', runId)
    .eq('status', 'refining')
    .eq('updated_at', row.updated_at)
    .select('*')
    .maybeSingle()
  if (error) throw storeError('claimConceptUnit', error)
  return data
}

// Settles a claimed unit (clears the claim) — CAS on the CLAIMED row's stamp.
export async function settleConceptUnit(
  db: Db,
  runId: string,
  claimed: Pick<DesignConceptRow, 'id' | 'updated_at'>,
  patch: ConceptUnitPatch
): Promise<DesignConceptRow | null> {
  const { data, error } = await db
    .from('design_concepts')
    .update(unitUpdate(patch, stampAfter(claimed.updated_at)))
    .eq('id', claimed.id)
    .eq('run_id', runId)
    .eq('status', 'refining')
    .eq('updated_at', claimed.updated_at)
    .select('*')
    .maybeSingle()
  if (error) throw storeError('settleConceptUnit', error)
  return data
}

// Settles a concept's FIRST render — CAS on the row claimConceptRender
// returned (the pending → refining flip). A late worker whose concept was
// swept, retried and re-claimed meanwhile finds a different stamp and writes
// nothing (null), so it can't overwrite the new worker's loop state.
export async function settleInitialRender(
  db: Db,
  runId: string,
  claimed: Pick<DesignConceptRow, 'id' | 'updated_at'>,
  patch: ConceptUnitPatch
): Promise<DesignConceptRow | null> {
  const { data, error } = await db
    .from('design_concepts')
    .update(unitUpdate(patch, stampAfter(claimed.updated_at)))
    .eq('id', claimed.id)
    .eq('run_id', runId)
    .eq('status', 'refining')
    .eq('updated_at', claimed.updated_at)
    .select('*')
    .maybeSingle()
  if (error) throw storeError('settleInitialRender', error)
  return data
}

// Retry: mid-loop concepts resume at their next unit, with the claim and any
// attempt notes cleared. Only the FIRST (by position) goes back to 'refining'
// — the loop runs one concept at a time, and a 'refining' row left waiting
// would be swept to error — the rest are parked as 'pending' with their review
// kept (nextAction resumes each in turn). Rows without a review are skipped.
// Like resetConcepts, each write is a CAS on the row as the Retry read it.
export async function resumeConcepts(db: Db, runId: string, rows: DesignConceptRow[]): Promise<void> {
  const inLoop = rows
    .flatMap((row) => {
      const review = parseConceptReview(row.critique)
      return review ? [{ row, review }] : []
    })
    .sort((a, b) => a.row.position - b.row.position)
  for (const [index, { row, review }] of inLoop.entries()) {
    const { error } = await db
      .from('design_concepts')
      .update({
        status: index === 0 ? 'refining' : 'pending',
        error: null,
        critique: asJson({ ...review, claim: null, notes: dropAttemptNotes(review.notes) }),
        updated_at: stampAfter(row.updated_at),
      })
      .eq('id', row.id)
      .eq('run_id', runId)
      .eq('updated_at', row.updated_at)
    if (error) throw storeError('resumeConcepts', error)
  }
}

// Resumes a concept parked mid-loop ('pending' with a review) — back to
// 'refining', review untouched: a CAS on the row as read, like a unit claim.
// null ⇒ another step resumed or changed it.
export async function resumeParkedConcept(
  db: Db,
  runId: string,
  row: Pick<DesignConceptRow, 'id' | 'updated_at'>
): Promise<DesignConceptRow | null> {
  const { data, error } = await db
    .from('design_concepts')
    .update({ status: 'refining', error: null, updated_at: stampAfter(row.updated_at) })
    .eq('id', row.id)
    .eq('run_id', runId)
    .eq('status', 'pending')
    .eq('updated_at', row.updated_at)
    .select('*')
    .maybeSingle()
  if (error) throw storeError('resumeParkedConcept', error)
  return data
}
