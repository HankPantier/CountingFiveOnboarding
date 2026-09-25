import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/design/input-validation'
import { ActiveRunExistsError, deleteConcepts, getRun, listConcepts, resetConcepts, resumeConcepts, transitionRun } from '@/lib/design/run-store'
import { parseBaseSnapshot, planRetry } from '@/lib/design/run-state'
import { dropAttemptNotes } from '@/lib/design/review'
import { chainOrFail, failActiveRun } from '@/lib/design/run-trigger'
import { RUN_ACTIVE_STATUSES } from '@/lib/design/studio-types'
import { authorizeStep, type StepTarget } from '../../../_step-auth'

export const runtime = 'nodejs'
// One unit per step: one generate call (+ one repair), one critique call, one
// revise call, or one render (+ metrics). All model calls finish by 540 s
// (STEP_MODEL_BUDGET_MS); a render is two warm renders (~5–20 s). Must stay a literal for Next.js — pinned by a test to
// DESIGN_STEP_MAX_DURATION_S (planRetry's stale-claim window).
export const maxDuration = 600

const WORKER_UNAVAILABLE = 'The design worker is unavailable right now — press Retry.'
const WORKER_CRASHED = 'The design step crashed — press Retry.'

// The orchestrator pulls in the CSS sanitizer (native lightningcss) and the
// renderer (playwright-core / @sparticuz/chromium), all traced by path — see
// next.config.ts. Loaded lazily so a packaging fault errors ONE run with a
// retryable message instead of crashing the whole route module at cold start.
async function runStepInBackground(target: StepTarget, runId: string): Promise<void> {
  const db = createServerClient()
  let orchestrator: typeof import('@/lib/design/run-orchestrator')
  try {
    orchestrator = await import('@/lib/design/run-orchestrator')
  } catch (err) {
    console.error('[design-step] failed to load the design worker', err)
    await failActiveRun(db, runId, WORKER_UNAVAILABLE)
    return
  }
  try {
    const outcome = await orchestrator.runDesignStep({ ...target, runId })
    if (orchestrator.shouldChain(outcome)) await chainOrFail(db, target.sessionId, runId)
  } catch (err) {
    console.error('[design-step] step crashed', err)
    await failActiveRun(db, runId, WORKER_CRASHED)
  }
}

// POST — advance a design run by one unit of work (in the background).
//   Bearer CRON_SECRET (the self-chain): just advance.
//   Admin: a failed run is RETRIED from its first unfinished stage; an active
//   run is nudged (a stalled chain restarts; duplicate calls are no-ops thanks
//   to the guarded claims); a finished run is a 409.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params
  const caller = await authorizeStep(req, id)
  if (caller instanceof NextResponse) return caller
  if (!isUuid(runId)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })

  try {
    const db = createServerClient()
    const run = await getRun(db, caller.target.sessionId, runId)
    if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

    if (caller.kind === 'admin') {
      if (run.status === 'error') {
        const concepts = await listConcepts(db, run.id)
        const plan = planRetry(run, concepts)
        if (!plan.ok) return NextResponse.json({ error: plan.reason }, { status: 409 })
        // The concept side FIRST, while the run is still 'error' (no step acts
        // on an errored run): once the run is active again a concurrent step
        // must never see the stale concept set (e.g. nothing pending ⇒
        // finalize). Every concept write is a CAS on the row as read above, so
        // if a concurrent Retry got there first these writes match nothing,
        // and a Retry whose transition below loses leaves only rows that the
        // next Retry plans from as usual (deletes are of dead rows only).
        await deleteConcepts(db, run.id, plan.deleteConceptIds)
        await resetConcepts(
          db,
          run.id,
          concepts.filter((c) => plan.resetConceptIds.includes(c.id))
        )
        // Mid-loop concepts: the first (by position) back to refining, the
        // rest parked pending — nextAction resumes each in turn.
        await resumeConcepts(
          db,
          run.id,
          concepts.filter((c) => plan.resumeConceptIds.includes(c.id))
        )
        // The gate: only the Retry that moves the run out of 'error' proceeds.
        // R8b: notes describing the failed attempt (renderer down, …) go; the
        // retried work re-adds them if it fails again.
        const base = parseBaseSnapshot(run.base_snapshot)
        const moved = await transitionRun(db, run.id, ['error'], {
          status: plan.status,
          stage: plan.stage,
          error: null,
          baseSnapshot: { ...base, notes: dropAttemptNotes(base.notes) },
        })
        if (!moved) return NextResponse.json({ error: 'The run changed — refresh and try again.' }, { status: 409 })
      } else if (!(RUN_ACTIVE_STATUSES as readonly string[]).includes(run.status)) {
        return NextResponse.json({ error: 'This run has finished — start a new one.' }, { status: 409 })
      }
    }

    after(async () => {
      await runStepInBackground(caller.target, runId)
    })
    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (err) {
    if (err instanceof ActiveRunExistsError) {
      return NextResponse.json({ error: 'Another design run is in progress for this client.' }, { status: 409 })
    }
    return internalError('design:runs:step', err, 'Failed to advance the design run')
  }
}
