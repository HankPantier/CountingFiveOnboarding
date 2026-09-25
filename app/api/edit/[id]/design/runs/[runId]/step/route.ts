import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/design/input-validation'
import { ActiveRunExistsError, deleteConcepts, getRun, listConcepts, resetConcepts, transitionRun } from '@/lib/design/run-store'
import { planRetry } from '@/lib/design/run-state'
import { chainOrFail, failActiveRun } from '@/lib/design/run-trigger'
import { RUN_ACTIVE_STATUSES } from '@/lib/design/studio-types'
import { authorizeStep, type StepTarget } from '../../../_step-auth'

export const runtime = 'nodejs'
// A generate step (ONE concept: one Opus call + one repair) is budgeted to
// finish by 540 s (GENERATE_BUDGET_MS); a render step is two warm renders
// (~5–20 s).
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
        const plan = planRetry(run, await listConcepts(db, run.id))
        if (!plan.ok) return NextResponse.json({ error: plan.reason }, { status: 409 })
        const moved = await transitionRun(db, run.id, ['error'], { status: plan.status, stage: plan.stage, error: null })
        if (!moved) return NextResponse.json({ error: 'The run changed — refresh and try again.' }, { status: 409 })
        await deleteConcepts(db, run.id, plan.deleteConceptIds)
        await resetConcepts(db, run.id, plan.resetConceptIds)
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
