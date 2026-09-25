import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { listInputs } from '@/lib/design/store'
import { readDraftThemeSnapshot } from '@/lib/design/theme-snapshot'
import { readDesignCapabilities } from '@/lib/design/capabilities-read'
import { ActiveRunExistsError, createRun } from '@/lib/design/run-store'
import { parseCreateRunBody } from '@/lib/design/run-request'
import { chainOrFail, failActiveRun, STEP_CHAIN_ERROR } from '@/lib/design/run-trigger'
import { loadLatestRunDto } from '@/lib/design/run-view'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

type Params = { params: Promise<{ id: string }> }

// Body of POST design/runs (all optional — see parseCreateRunBody defaults).
interface CreateRunBody {
  paletteFreedom?: unknown
  adminBrief?: unknown
  inputIds?: unknown
  conceptCount?: unknown
  pagePath?: unknown
}

// GET — the session's latest design run (the Studio polls this while a run is
// active). Admin-only.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    return NextResponse.json({ run: await loadLatestRunDto(createServerClient(), ctx.sessionId) })
  } catch (err) {
    return internalError('design:runs:latest', err, 'Failed to load the design run')
  }
}

// POST — start a design run: validate, snapshot the draft theme shas + the
// template capability tier, insert a queued run (one active run per session),
// then kick off the first step in the background. The heavy work (brief,
// model, renderer) happens in the step route, never here.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const raw = await readJsonBody<CreateRunBody>(req)
  if (raw instanceof NextResponse) return raw
  const parsed = parseCreateRunBody(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
  const request = parsed.value

  try {
    const supabase = createServerClient()
    const known = new Set((await listInputs(supabase, ctx.sessionId)).map((i) => i.id))
    if (request.inputIds.some((i) => !known.has(i))) {
      return NextResponse.json({ error: 'One or more selected inputs no longer exist — refresh and try again.' }, { status: 400 })
    }
    const snapshot = await readDraftThemeSnapshot(ctx.githubRepo) // also ensures the draft branch
    const capabilities = await readDesignCapabilities(ctx.githubRepo)
    const run = await createRun(supabase, {
      sessionId: ctx.sessionId,
      createdBy: ctx.adminId,
      paletteFreedom: request.paletteFreedom,
      adminBrief: request.adminBrief,
      conceptCount: request.conceptCount,
      inputIds: request.inputIds,
      capabilities,
      baseSnapshot: { pagePath: request.pagePath, themeShas: snapshot.shas, screenshots: [], notes: [] },
    })
    after(async () => {
      try {
        await chainOrFail(createServerClient(), ctx.sessionId, run.id)
      } catch (err) {
        // chainOrFail already fails the run when the trigger fetch itself
        // fails; this is a backstop against an unexpected throw so the run
        // never sits queued silently instead of getting marked retryable.
        console.error('[design:runs:create] chain kickoff threw unexpectedly', err)
        await failActiveRun(createServerClient(), run.id, STEP_CHAIN_ERROR)
      }
    })
    return NextResponse.json({ runId: run.id }, { status: 202 })
  } catch (err) {
    if (err instanceof ActiveRunExistsError) {
      return NextResponse.json({ error: 'A design run is already in progress for this client.' }, { status: 409 })
    }
    return internalError('design:runs:create', err, 'Failed to start the design run')
  }
}
