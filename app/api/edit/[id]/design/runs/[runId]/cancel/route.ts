import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/design/input-validation'
import { getRun, transitionRun } from '@/lib/design/run-store'
import { RUN_ACTIVE_STATUSES } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../../../_design'

export const runtime = 'nodejs'
export const maxDuration = 15

// POST — cancel an in-progress run. The step worker's next guarded write finds
// no row and exits; an in-flight model call finishes, and its cost is still
// recorded (token_usage + run.cost_usd). Admin-only.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(runId)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  try {
    const db = createServerClient()
    const run = await getRun(db, ctx.sessionId, runId)
    if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })
    const cancelled = await transitionRun(db, runId, RUN_ACTIVE_STATUSES, { status: 'cancelled', error: null })
    if (!cancelled) return NextResponse.json({ error: 'This run is not in progress.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return internalError('design:runs:cancel', err, 'Failed to cancel the design run')
  }
}
