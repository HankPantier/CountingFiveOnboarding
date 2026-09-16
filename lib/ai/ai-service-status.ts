import { createServerClient } from '@/lib/supabase/server'

// Global AI-service status: a single-row flag recording when a Claude call last
// failed for lack of credits. Because a credit outage takes down every AI feature
// at once, the admin shell reads this to show one proactive banner instead of
// letting operators discover it one failed action at a time. Writes are
// best-effort — a status-tracking failure must NEVER break the AI path it wraps.

// How long a credit failure keeps the banner up without any refresh. As long as
// AI calls keep failing the timestamp is refreshed, so the banner persists during
// a real outage; once calls stop failing (credits topped up) it self-heals after
// this window even if no admin clears it manually.
export const CREDIT_STALE_MS = 30 * 60 * 1000

export interface AiCreditStatus {
  exhausted: boolean
  since: string | null // ISO timestamp of the most recent credit failure, if any
}

// Pure: is a credit-exhausted timestamp recent enough to still show the banner?
// Extracted so the window logic is unit-testable without a DB.
export function isCreditRecent(
  creditExhaustedAt: string | null | undefined,
  nowMs: number,
  windowMs: number = CREDIT_STALE_MS,
): boolean {
  if (!creditExhaustedAt) return false
  const t = Date.parse(creditExhaustedAt)
  if (Number.isNaN(t)) return false
  return nowMs - t < windowMs
}

// Stamp "credits are out" now. Fire-and-forget from an error handler; swallows
// its own failure (incl. the table not being migrated yet).
export async function recordAiCreditExhausted(): Promise<void> {
  try {
    const supabase = createServerClient()
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('ai_service_status')
      .upsert({ id: true, credit_exhausted_at: now, updated_at: now }, { onConflict: 'id' })
    if (error) console.warn('[ai-status] record credit-exhausted failed:', error.message)
  } catch (err) {
    console.warn('[ai-status] record credit-exhausted threw:', err)
  }
}

// Clear the flag (an admin topped up the account). Best-effort.
export async function clearAiCreditExhausted(): Promise<void> {
  const supabase = createServerClient()
  const { error } = await supabase
    .from('ai_service_status')
    .update({ credit_exhausted_at: null, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) console.warn('[ai-status] clear credit-exhausted failed:', error.message)
}

// Read the current status for the admin shell. Degrades to "not exhausted" if the
// table is missing (pre-migration) or the read fails — the banner is advisory.
export async function getAiCreditStatus(): Promise<AiCreditStatus> {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('ai_service_status')
      .select('credit_exhausted_at')
      .eq('id', true)
      .maybeSingle()
    if (error || !data) return { exhausted: false, since: null }
    const exhausted = isCreditRecent(data.credit_exhausted_at, Date.now())
    return { exhausted, since: exhausted ? data.credit_exhausted_at : null }
  } catch {
    return { exhausted: false, since: null }
  }
}
