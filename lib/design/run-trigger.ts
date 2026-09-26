// Server-only. Self-chaining for Design Studio runs (the content-generator
// pattern): each step invocation does one unit of work, then POSTs the step
// route with Bearer CRON_SECRET to start the next in a FRESH function (its own
// maxDuration).
//
// A REFUSED chain call is not a failure. Vercel's recursion protection
// answers a deployment's ~5th self-call in one x-vercel-id chain with 508
// (INFINITE_LOOP_DETECTED), and a full run needs far more hops — so the run
// stays active and is marked stalled (markRunChainStalled); the Studio poll
// or the sweep cron nudges it from outside the chain (isRunStalled). Only a
// misconfiguration (no app URL / CRON_SECRET), which no nudge can fix, errors
// the run with a retryable message.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { RUN_ACTIVE_STATUSES } from './studio-types'
import { markRunChainStalled, transitionRun } from './run-store'
import { NUDGE_PARAM } from './studio-ui'

export const STEP_CHAIN_ERROR = 'Couldn’t start the next background step — press Retry.'
const TRIGGER_TIMEOUT_MS = 15_000

// `nudge`: flag the call as a nudge (the sweep cron) — the step route then
// 409s a run that is no longer active instead of accepting a no-op.
export function designStepUrl(baseUrl: string, sessionId: string, runId: string, opts: { nudge?: boolean } = {}): string {
  const base = (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).replace(/\/+$/, '')
  return `${base}/api/edit/${sessionId}/design/runs/${runId}/step${opts.nudge ? `?${NUDGE_PARAM}=1` : ''}`
}

// started: the step route accepted (2xx). refused: a non-2xx (e.g. 508),
// network error or timeout — a nudge can recover. misconfigured: no app URL
// or CRON_SECRET — nothing can.
export type TriggerResult = 'started' | 'refused' | 'misconfigured'

export async function triggerDesignStep(sessionId: string, runId: string, opts: { nudge?: boolean } = {}): Promise<TriggerResult> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  const cronSecret = process.env.CRON_SECRET
  if (!baseUrl || !cronSecret) {
    console.warn('[design-run] step chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing')
    return 'misconfigured'
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${cronSecret}` }
  // Deployment-Protected previews reject the self-call without Vercel's
  // automation bypass. Never logged.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypass) headers['x-vercel-protection-bypass'] = bypass
  try {
    const res = await fetch(designStepUrl(baseUrl, sessionId, runId, opts), {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[design-run] step chain returned ${res.status}`)
      return 'refused'
    }
    return 'started'
  } catch (err) {
    console.warn('[design-run] step chain failed', err)
    return 'refused'
  }
}

export async function failActiveRun(db: SupabaseClient<Database>, runId: string, message: string): Promise<void> {
  try {
    await transitionRun(db, runId, RUN_ACTIVE_STATUSES, { status: 'error', error: message })
  } catch (err) {
    console.error('[design-run] could not mark the run as failed', err)
  }
}

// Starts the next step. Refused ⇒ the run stays active, marked stalled for a
// nudge (a failed marker write only delays the nudge to the idle threshold).
// Misconfigured ⇒ the run is errored (retryable once the env is fixed).
export async function chainOrFail(db: SupabaseClient<Database>, sessionId: string, runId: string): Promise<void> {
  const result = await triggerDesignStep(sessionId, runId)
  if (result === 'started') return
  if (result === 'misconfigured') {
    await failActiveRun(db, runId, STEP_CHAIN_ERROR)
    return
  }
  try {
    await markRunChainStalled(db, sessionId, runId)
    console.warn(`[design-run] chain stalled for run ${runId} — left active for a nudge`)
  } catch (err) {
    console.warn('[design-run] could not mark the run as stalled', err)
  }
}
