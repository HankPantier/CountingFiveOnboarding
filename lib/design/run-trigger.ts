// Server-only. Self-chaining for Design Studio runs (the content-generator
// pattern): each step invocation does one unit of work, then POSTs the step
// route with Bearer CRON_SECRET to start the next in a FRESH function (its own
// maxDuration). When the chain can't start, the run is errored with a
// retryable message instead of sitting 'active' until the 15-minute sweep.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { RUN_ACTIVE_STATUSES } from './studio-types'
import { transitionRun } from './run-store'

export const STEP_CHAIN_ERROR = 'Couldn’t start the next background step — press Retry.'
const TRIGGER_TIMEOUT_MS = 15_000

export function designStepUrl(baseUrl: string, sessionId: string, runId: string): string {
  const base = (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).replace(/\/+$/, '')
  return `${base}/api/edit/${sessionId}/design/runs/${runId}/step`
}

export async function triggerDesignStep(sessionId: string, runId: string): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  const cronSecret = process.env.CRON_SECRET
  if (!baseUrl || !cronSecret) {
    console.warn('[design-run] step chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing')
    return false
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${cronSecret}` }
  // Deployment-Protected previews reject the self-call without Vercel's
  // automation bypass. Never logged.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypass) headers['x-vercel-protection-bypass'] = bypass
  try {
    const res = await fetch(designStepUrl(baseUrl, sessionId, runId), {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[design-run] step chain returned ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[design-run] step chain failed', err)
    return false
  }
}

export async function failActiveRun(db: SupabaseClient<Database>, runId: string, message: string): Promise<void> {
  try {
    await transitionRun(db, runId, RUN_ACTIVE_STATUSES, { status: 'error', error: message })
  } catch (err) {
    console.error('[design-run] could not mark the run as failed', err)
  }
}

export async function chainOrFail(db: SupabaseClient<Database>, sessionId: string, runId: string): Promise<void> {
  if (!(await triggerDesignStep(sessionId, runId))) await failActiveRun(db, runId, STEP_CHAIN_ERROR)
}
