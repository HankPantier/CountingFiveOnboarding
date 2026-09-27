import { createServerClient } from '@/lib/supabase/server'
import { isAiOutageKind, normalizeResetDate, usageLimitHasReset, type AiOutageKind } from './ai-outage'

// Global AI-service status: a single-row flag recording when a Claude call last
// failed for an account-level reason — out of credits, or the account's usage
// limit reached (migration 080 records which, plus the limit's reset date). Because a credit outage takes down every AI feature
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
  since: string | null // ISO timestamp of the most recent outage failure, if any
  kind: AiOutageKind // which outage (pre-080 rows: always 'credit')
  resetDate: string | null // usage_limit only: the provider's "regain access on" date
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

// Stamp an account-level outage now. Fire-and-forget from an error handler;
// swallows its own failure (incl. the table not being migrated yet). Before
// migration 080 the kind columns don't exist: a credit outage then falls back
// to the 072 write (the credit banner still shows); a usage limit is skipped
// rather than mis-bannered as "credits have run out".
export async function recordAiOutage(kind: AiOutageKind, resetDate: string | null = null): Promise<void> {
  try {
    const supabase = createServerClient()
    const now = new Date().toISOString()
    const { error } = await supabase.from('ai_service_status').upsert(
      {
        id: true,
        credit_exhausted_at: now,
        outage_kind: kind,
        usage_limit_resets_on: kind === 'usage_limit' ? normalizeResetDate(resetDate) : null,
        updated_at: now,
      },
      { onConflict: 'id' }
    )
    if (!error) return
    if (kind !== 'credit') {
      console.warn(`[ai-status] record ${kind} failed (migration 080 applied?):`, error.message)
      return
    }
    const legacy = await supabase
      .from('ai_service_status')
      .upsert({ id: true, credit_exhausted_at: now, updated_at: now }, { onConflict: 'id' })
    if (legacy.error) console.warn('[ai-status] record credit-exhausted failed:', legacy.error.message)
  } catch (err) {
    console.warn(`[ai-status] record ${kind} threw:`, err)
  }
}

export async function recordAiCreditExhausted(): Promise<void> {
  return recordAiOutage('credit')
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

// Pure: the banner state for a stored row (extracted for unit tests).
export function outageStatusFromRow(
  row: { credit_exhausted_at: string | null; outage_kind?: string | null; usage_limit_resets_on?: string | null },
  nowMs: number
): AiCreditStatus {
  const kind: AiOutageKind = isAiOutageKind(row.outage_kind) ? row.outage_kind : 'credit'
  const resetDate = kind === 'usage_limit' ? normalizeResetDate(row.usage_limit_resets_on) : null
  const exhausted = isCreditRecent(row.credit_exhausted_at, nowMs) && !(kind === 'usage_limit' && usageLimitHasReset(resetDate, nowMs))
  return { exhausted, since: exhausted ? row.credit_exhausted_at : null, kind, resetDate }
}

const NOT_EXHAUSTED: AiCreditStatus = { exhausted: false, since: null, kind: 'credit', resetDate: null }

// Read the current status for the admin shell. Degrades to "not exhausted" if the
// table is missing (pre-migration) or the read fails — the banner is advisory.
// Before migration 080 the kind columns are missing: fall back to the 072 read.
export async function getAiCreditStatus(): Promise<AiCreditStatus> {
  try {
    const supabase = createServerClient()
    const full = await supabase
      .from('ai_service_status')
      .select('credit_exhausted_at, outage_kind, usage_limit_resets_on')
      .eq('id', true)
      .maybeSingle()
    if (!full.error) return full.data ? outageStatusFromRow(full.data, Date.now()) : NOT_EXHAUSTED
    const legacy = await supabase.from('ai_service_status').select('credit_exhausted_at').eq('id', true).maybeSingle()
    if (legacy.error || !legacy.data) return NOT_EXHAUSTED
    return outageStatusFromRow(legacy.data, Date.now())
  } catch {
    return NOT_EXHAUSTED
  }
}
