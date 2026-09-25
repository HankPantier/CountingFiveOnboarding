// Gate for the Design Studio step route: the ONE design route a machine may
// call. Any Authorization header means "internal chain" and is checked
// fail-closed (CLAUDE.md rule 2): an empty/unset CRON_SECRET is a 500 — never
// let "Bearer undefined" match — and anything else but the exact bearer is a
// 401. Without the header, the caller must be an admin (requireDesignAdmin).
// The cron path resolves the same editor preconditions resolveEditContext
// enforces (phase ≥ 6, provisioned repo) without a user session.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/design/input-validation'
import { requireDesignAdmin } from './_design'

export type StepTarget = { sessionId: string; jobId: string; githubRepo: string }
export type StepCaller = { kind: 'cron'; target: StepTarget } | { kind: 'admin'; target: StepTarget; adminId: string }

export async function authorizeStep(req: Request, sessionId: string): Promise<StepCaller | NextResponse> {
  const header = req.headers.get('authorization')
  if (header === null) {
    const ctx = await requireDesignAdmin(sessionId)
    if (ctx instanceof NextResponse) return ctx
    return { kind: 'admin', target: { sessionId: ctx.sessionId, jobId: ctx.jobId, githubRepo: ctx.githubRepo }, adminId: ctx.adminId }
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  if (header !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isUuid(sessionId)) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })

  const { data: job, error } = await createServerClient()
    .from('content_jobs')
    .select('id, session_id, phase, github_repo')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw new Error(`[design-step] content job lookup failed: ${error.message}`)
  if (!job) return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  if (job.phase < 6 || !job.github_repo) return NextResponse.json({ error: 'The site is not editable yet.' }, { status: 409 })
  return { kind: 'cron', target: { sessionId: job.session_id, jobId: job.id, githubRepo: job.github_repo } }
}
