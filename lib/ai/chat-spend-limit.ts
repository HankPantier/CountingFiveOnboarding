import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isSiteOwner, type CurrentUser } from '@/lib/auth/access'

// Per-user spend ceiling for the expensive AI editors (the per-page AI editor
// and the site assistant): Sonnet 5 at medium effort, up to 40 tool steps and a
// GitHub commit per edit. Computed from the user's own recorded spend in
// token_usage over rolling windows — no extra table, and it bounds dollars (and
// the commits that come with them) rather than request count.
//
// Spend is recorded in each run's onFinish, so the check sees completed runs
// only; a burst of parallel requests can overshoot by at most those runs.

export type SpendTier = 'admin' | 'member' | 'owner'

export interface SpendLimit {
  hourUsd: number
  dayUsd: number
}

// All ceilings in one place. A heavy multi-part editor run costs roughly
// $0.50-$1; these leave normal use untouched and stop a runaway loop.
// Site Owners (external clients) get the lowest ceiling.
export const CHAT_SPEND_LIMITS: Record<SpendTier, SpendLimit> = {
  admin: { hourUsd: 25, dayUsd: 100 },
  member: { hourUsd: 10, dayUsd: 40 },
  owner: { hourUsd: 3, dayUsd: 10 },
}

// token_usage stages the limiter counts (the two AI editors).
export const LIMITED_CHAT_STAGES = ['content_edit', 'site_structure_edit'] as const

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export function spendTierFor(user: CurrentUser): SpendTier {
  if (user.isAdmin) return 'admin'
  if (isSiteOwner(user)) return 'owner'
  return 'member'
}

export interface SpendRow {
  cost_usd: number | string | null
  created_at: string
}

export type SpendVerdict = { allowed: true } | { allowed: false; window: 'hour' | 'day' }

// Pure verdict over the user's rows from the last 24h.
export function evaluateSpend(rows: SpendRow[], limit: SpendLimit, now = Date.now()): SpendVerdict {
  let day = 0
  let hour = 0
  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0
    const at = Date.parse(r.created_at)
    if (!Number.isFinite(at) || now - at > DAY_MS) continue
    day += cost
    if (now - at <= HOUR_MS) hour += cost
  }
  if (hour >= limit.hourUsd) return { allowed: false, window: 'hour' }
  if (day >= limit.dayUsd) return { allowed: false, window: 'day' }
  return { allowed: true }
}

export function spendLimitMessage(window: 'hour' | 'day'): string {
  return window === 'hour'
    ? "You've reached the AI editing limit for the past hour. Please try again a little later."
    : "You've reached today's AI editing limit. Please try again tomorrow."
}

// Returns a 429 NextResponse when the user is over their ceiling, else null.
// Fails OPEN on a read error (same stance as checkRateLimit): the ceiling is
// abuse protection, not a correctness gate.
export async function checkChatSpendLimit(
  supabase: SupabaseClient<Database>,
  user: CurrentUser
): Promise<NextResponse | null> {
  const since = new Date(Date.now() - DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('token_usage')
    .select('cost_usd, created_at')
    .eq('created_by', user.id)
    .in('stage', [...LIMITED_CHAT_STAGES])
    .gte('created_at', since)
  if (error) {
    console.error('[chat-spend-limit] read failed for', user.id, error.message)
    return null
  }
  const verdict = evaluateSpend(data ?? [], CHAT_SPEND_LIMITS[spendTierFor(user)])
  if (verdict.allowed) return null
  console.warn(`[chat-spend-limit] ${spendTierFor(user)} ${user.id} over the ${verdict.window} ceiling`)
  return NextResponse.json({ error: spendLimitMessage(verdict.window) }, { status: 429 })
}
