import { createServerClient } from '@/lib/supabase/server'
import { runAuditJob } from './worker'

// Run a batch's audits strictly one at a time. Each URL is a normal audit_runs
// row; runAuditJob does the full crawl + scoring + intelligence and writes its
// own terminal state, exactly as the single-audit /run route drives it.
//
// Structurally mirrors runBlogBatch (soft-deadline + authenticated self-chain to
// stay under the route cap) with one critical difference: a single audit can
// itself consume nearly the whole cap (the worker gives each run a ~560s shared
// deadline within the 600s route), so we must not START an audit we can't finish.
// We therefore only begin a new audit while still very early in the invocation
// (≤30s, leaving ≥570s ≥ the per-run deadline); anything past that chains a fresh
// invocation. Fast sites still pack several per run; heavy sites get one.
const START_CUTOFF_MS = 30_000

// Statuses a run passes through while executing — mirrors RUNNING_STATES in
// app/api/audits/[id]/run/route.ts and RUNNING_AUDIT_STATES in the sweep cron.
const RUNNING_STATES = ['crawling', 'analyzing', 'researching', 'scoring', 'rendering']

export async function runAuditBatch(batchId: string): Promise<void> {
  const supabase = createServerClient()

  const { data: runs } = await supabase
    .from('audit_runs')
    .select('id, audit_status')
    .eq('audit_batch_id', batchId)
    .order('created_at', { ascending: true })

  if (!runs?.length) {
    console.warn('[audit-batch] No runs for batch:', batchId)
    return
  }

  // Only queued runs need work; this makes the runner idempotent across chained
  // continuations and cron resumes. A run already complete/error/running is left
  // alone (the atomic claim below is the race-safe gate on 'queued').
  const pending = runs.filter((r) => r.audit_status === 'queued')

  const startedAt = Date.now()
  let completedThisRun = 0

  for (const run of pending) {
    // Never begin an audit we can't finish inside the 300s route cap.
    if (Date.now() - startedAt > START_CUTOFF_MS) break

    // Atomic claim: flip queued → crawling only if still queued, so a duplicate
    // chain (or a cron resume racing a live worker) can't start two runs for the
    // same audit. Mirrors the guard in app/api/audits/[id]/run/route.ts.
    const { data: claimed } = await supabase
      .from('audit_runs')
      .update({
        audit_status: 'crawling',
        status_detail: 'Starting…',
        started_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', run.id)
      .eq('audit_status', 'queued')
      .select('id')

    if (!claimed?.length) continue // Another worker claimed it — skip.

    try {
      await runAuditJob(run.id)
    } catch (err) {
      // runAuditJob writes its own terminal state on internal failure, but guard
      // an unexpected throw so the row can't be stranded in 'crawling'.
      console.error('[audit-batch] runAuditJob threw for', run.id, err)
      await supabase
        .from('audit_runs')
        .update({
          audit_status: 'error',
          status_detail: 'Audit failed',
          error_message: 'Batch worker error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', run.id)
    }
    completedThisRun += 1
  }

  // Recompute batch state from the live rows.
  const { data: allRuns } = await supabase
    .from('audit_runs')
    .select('audit_status')
    .eq('audit_batch_id', batchId)

  const rows = allRuns ?? []
  const unresolved = rows.filter(
    (r) => r.audit_status === 'queued' || RUNNING_STATES.includes(r.audit_status),
  )
  const allDone = unresolved.length === 0

  // Auto-chain when work remains and this run made progress. The completedThisRun
  // guard prevents an endless cascade if every claim contended or stalled; the
  // sweep cron re-triggers the batch in that case.
  if (!allDone && completedThisRun > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    const cronSecret = process.env.CRON_SECRET
    if (!baseUrl || !cronSecret) {
      console.warn('[audit-batch] Auto-chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.')
      return
    }
    const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
    try {
      const res = await fetch(`${url}/api/audit-batches/${batchId}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      console.warn(`[audit-batch] Chained continuation: completed=${completedThisRun} this run, status=${res.status}`)
    } catch (err) {
      console.error('[audit-batch] Auto-chain self-call failed:', err)
    }
    return
  }

  if (allDone) {
    const completed = rows.filter((r) => r.audit_status === 'complete').length
    const errored = rows.filter((r) => r.audit_status === 'error').length
    const status = completed === 0 && errored > 0 ? 'error' : 'complete'
    await supabase
      .from('audit_batches')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', batchId)
    console.warn(`[audit-batch] Batch ${batchId} done: complete=${completed} error=${errored}`)
  }
}
