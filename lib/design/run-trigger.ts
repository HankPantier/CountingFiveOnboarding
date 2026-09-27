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
//
// HOP BUDGET. Vercel propagates the chain id on EVERY outbound fetch of a
// function, so a step's live-site / preview-shell fetch is itself another hop
// — deep in a chain it also gets 508 (a render skipped, a concept left
// uncritiqued). So the chain is kept shallow on purpose: each self-call
// carries its depth in DESIGN_HOP_HEADER, and a step at MAX_CHAIN_HOPS stops
// chaining and marks the run stalled instead — an expected, warn-level stall
// that the Studio poll (≤ ~20 s) or the sweep cron restarts as a fresh chain.
// Hop 0 is a step started from a browser request (Studio Retry / nudge); the
// run kickoff (POST /design/runs) and the cron nudge are themselves one
// function deep, so the steps they start are hop 1. The header is only read
// on the Bearer path, only as a small integer, and never grants anything —
// a forged value can only make a chain shorter.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { RUN_ACTIVE_STATUSES } from './studio-types'
import { markRunChainStalled, transitionRun } from './run-store'
import { NUDGE_PARAM } from './studio-ui'

export const STEP_CHAIN_ERROR = 'Couldn’t start the next background step — press Retry.'
const TRIGGER_TIMEOUT_MS = 15_000

export const DESIGN_HOP_HEADER = 'x-design-hop'
// Steps at hop 0..MAX_CHAIN_HOPS run; the step AT the budget doesn't chain.
// With a step's own shell fetch that keeps every request ≤ 4 function-hops
// deep from its origin (Vercel refuses around the 5th).
export const MAX_CHAIN_HOPS = 2

// The hop of a Bearer-path step, from its (untrusted) header: absent ⇒ 0 (an
// external caller, e.g. a manual cron call); a small non-negative integer ⇒
// that, capped at the budget; anything else ⇒ the budget (a malformed value
// may never lengthen a chain). Admin (browser) steps are always hop 0 — the
// route never reads the header for them.
export function parseDesignHop(raw: string | null): number {
  if (raw === null) return 0
  const v = raw.trim()
  if (!/^\d{1,3}$/.test(v)) return MAX_CHAIN_HOPS
  return Math.min(Number(v), MAX_CHAIN_HOPS)
}

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

// `hop`: the hop of the step being started (sent as DESIGN_HOP_HEADER).
export async function triggerDesignStep(sessionId: string, runId: string, opts: { nudge?: boolean; hop: number }): Promise<TriggerResult> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  const cronSecret = process.env.CRON_SECRET
  if (!baseUrl || !cronSecret) {
    console.warn('[design-run] step chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing')
    return 'misconfigured'
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${cronSecret}`, [DESIGN_HOP_HEADER]: String(opts.hop) }
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

// Leaves the run active and marks it stalled so a nudge restarts it from a
// fresh chain (a failed marker write only delays the nudge to the idle
// threshold). Warn-level: this is the expected way a chain ends.
export async function stallForFreshChain(db: SupabaseClient<Database>, sessionId: string, runId: string, why: string): Promise<void> {
  try {
    await markRunChainStalled(db, sessionId, runId)
    console.warn(`[design-run] chain paused for run ${runId} (${why}) — left active for a nudge`)
  } catch (err) {
    console.warn('[design-run] could not mark the run as stalled', err)
  }
}

// Starts the next step from a step (or the kickoff) at hop `fromHop`. Past the
// hop budget ⇒ no call, the run is marked stalled (expected). Refused ⇒ the
// same. Misconfigured ⇒ the run is errored (retryable once the env is fixed).
export async function chainOrFail(db: SupabaseClient<Database>, sessionId: string, runId: string, fromHop: number): Promise<void> {
  const hop = fromHop + 1
  if (hop > MAX_CHAIN_HOPS) {
    await stallForFreshChain(db, sessionId, runId, `hop budget of ${MAX_CHAIN_HOPS} reached`)
    return
  }
  const result = await triggerDesignStep(sessionId, runId, { hop })
  if (result === 'started') return
  if (result === 'misconfigured') {
    await failActiveRun(db, runId, STEP_CHAIN_ERROR)
    return
  }
  await stallForFreshChain(db, sessionId, runId, 'the next step was refused')
}
