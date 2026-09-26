// Server-only. The sweep cron's backstop for stalled Design Studio runs (see
// isRunStalled in run-state.ts): when no Studio tab is open to nudge a run
// whose self-chain Vercel refused, the cron calls the step route itself — a
// cron-originated request starts a fresh chain. Runs it nudged are excluded
// from that tick's 15-minute stale → error sweep (sweepStuckDesignRows), so a
// run idle past 15 minutes is resumed rather than killed. A run idle past
// DESIGN_RUN_NUDGE_MAX_IDLE_MS is no longer nudged, so one whose nudges make
// no progress is swept to error like before. Fail-soft: never throws.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isRunStalled, lastRunProgressAt, type ConceptLite, type StallRunLite } from './run-state'
import { triggerDesignStep, type TriggerResult } from './run-trigger'
import { RUN_ACTIVE_STATUSES } from './studio-types'

export const DESIGN_RUN_NUDGE_MAX_IDLE_MS = 60 * 60 * 1000
export const MAX_DESIGN_NUDGES_PER_TICK = 5
const ACTIVE_RUN_SCAN_LIMIT = 50

export type NudgeCandidateRun = StallRunLite & { id: string; session_id: string }
export type NudgeCandidateConcept = ConceptLite & { run_id: string }
export type DesignNudgeResult = { nudged: string[]; refused: number }

// The runs to nudge: stalled, not idle past the ceiling, oldest progress first.
export function pickStalledRuns(
  runs: NudgeCandidateRun[],
  concepts: NudgeCandidateConcept[],
  now: number,
  limit: number = MAX_DESIGN_NUDGES_PER_TICK
): NudgeCandidateRun[] {
  const byRun = new Map<string, ConceptLite[]>()
  for (const c of concepts) byRun.set(c.run_id, [...(byRun.get(c.run_id) ?? []), c])
  return runs
    .map((run) => {
      const own = byRun.get(run.id) ?? []
      return { run, own, last: lastRunProgressAt(run, own) ?? 0 }
    })
    .filter(({ run, own, last }) => now - last <= DESIGN_RUN_NUDGE_MAX_IDLE_MS && isRunStalled(run, own, now))
    .sort((a, b) => a.last - b.last)
    .slice(0, limit)
    .map(({ run }) => run)
}

type Trigger = (sessionId: string, runId: string) => Promise<TriggerResult>

export async function nudgeStalledDesignRuns(
  db: SupabaseClient<Database>,
  now: number = Date.now(),
  trigger: Trigger = triggerDesignStep
): Promise<DesignNudgeResult> {
  const result: DesignNudgeResult = { nudged: [], refused: 0 }
  try {
    const { data: runs, error } = await db
      .from('design_runs')
      .select('id, session_id, status, stage, concept_count, updated_at, base_snapshot')
      .in('status', [...RUN_ACTIVE_STATUSES])
      .order('updated_at', { ascending: true })
      .limit(ACTIVE_RUN_SCAN_LIMIT)
    if (error) throw new Error(error.message)
    if (!runs?.length) return result
    const { data: concepts, error: conceptError } = await db
      .from('design_concepts')
      .select('id, run_id, position, status, bundle, updated_at, critique')
      .in(
        'run_id',
        runs.map((r) => r.id)
      )
    if (conceptError) throw new Error(conceptError.message)
    for (const run of pickStalledRuns(runs, concepts ?? [], now)) {
      const outcome = await trigger(run.session_id, run.id)
      if (outcome === 'started') result.nudged.push(run.id)
      else result.refused += 1
    }
  } catch (err) {
    console.error('[sweep-stuck-jobs] design run nudge failed:', err)
  }
  return result
}
