import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { nudgeStalledDesignRuns } from '@/lib/design/run-nudge'
import { requireCronBearer } from '@/lib/auth/cron-bearer'

export const runtime = 'nodejs'
// At most MAX_DESIGN_NUDGES_PER_TICK (5) sequential step triggers, each capped
// at 15 s — the step's work runs in its own invocation, not this one.
export const maxDuration = 90

// Every minute (vercel.json — per-minute crons need a Vercel Pro plan). A
// Design Studio run's self-chain stalls by design every few steps (hop budget,
// or Vercel's 508 recursion protection); with no Studio tab open to nudge it,
// this cron is what resumes it — from a fresh request chain, at
// CRON_NUDGE_HOP. The 5-minute sweep-stuck-jobs keeps its own nudge pass as a
// fallback; a duplicate nudge is a no-op (claim-guarded steps). This route
// never sweeps anything to error — that stays the sweep's job.
export async function GET(req: Request) {
  const denied = requireCronBearer(req)
  if (denied) return denied

  const result = await nudgeStalledDesignRuns(createServerClient(), Date.now(), undefined, 'nudge-design-runs')
  if (result.nudged.length || result.refused) {
    console.warn(`[nudge-design-runs] nudged=${result.nudged.length} refused=${result.refused}`)
  }
  return NextResponse.json({ nudged: result.nudged.length, refused: result.refused })
}
