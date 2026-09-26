// Server-only. Called by /api/cron/sweep-stuck-jobs. Resets Design Studio rows
// whose worker died mid-flight so the UI stops showing them as in progress
// (and, for runs, the "one active run per session" slot is released):
//   design_inputs  capture 'pending'           > 10 min → 'error' ("Capture timed out")
//   design_runs    queued/capturing/generating/refining > 15 min → 'error'
//   design_concepts generating/refining        > 15 min → 'error'
// Keyed on updated_at (stamped on claim / every step). Fail-soft: never throws.
// `skipRunIds`: runs the cron just nudged (nudgeStalledDesignRuns) — a run
// whose self-chain was refused and restarted is not stuck, so neither it nor
// its concepts (e.g. one parked 'refining' between loop units) are swept.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { CONCEPT_ACTIVE_STATUSES, RUN_ACTIVE_STATUSES } from './studio-types'

export const DESIGN_INPUT_STUCK_MS = 10 * 60 * 1000
export const DESIGN_RUN_STUCK_MS = 15 * 60 * 1000

export type DesignSweepResult = { inputs: number; runs: number; concepts: number }

type SweepQuery = PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>

async function count(label: string, run: () => SweepQuery): Promise<number> {
  try {
    const { data, error } = await run()
    if (error) {
      console.error(`[sweep-stuck-jobs] design ${label} sweep failed:`, error.message)
      return 0
    }
    return data?.length ?? 0
  } catch (err) {
    console.error(`[sweep-stuck-jobs] design ${label} sweep failed:`, err)
    return 0
  }
}

// PostgREST `in` list for .not(col, 'in', …) — ids are uuids from our own rows.
const inList = (ids: readonly string[]): string => `(${ids.join(',')})`

export async function sweepStuckDesignRows(
  supabase: SupabaseClient<Database>,
  now: number = Date.now(),
  opts: { skipRunIds?: readonly string[] } = {}
): Promise<DesignSweepResult> {
  const skip = opts.skipRunIds ?? []
  const stamp = new Date(now).toISOString()
  const inputCutoff = new Date(now - DESIGN_INPUT_STUCK_MS).toISOString()
  const runCutoff = new Date(now - DESIGN_RUN_STUCK_MS).toISOString()

  const [inputs, runs, concepts] = await Promise.all([
    count('inputs', () =>
      supabase
        .from('design_inputs')
        .update({ capture_status: 'error', capture_error: 'Capture timed out', updated_at: stamp })
        .eq('capture_status', 'pending')
        .lt('updated_at', inputCutoff)
        .select('id')
    ),
    count('runs', () => {
      const q = supabase
        .from('design_runs')
        .update({ status: 'error', error: 'Run timed out (swept by cron)', updated_at: stamp })
        .in('status', [...RUN_ACTIVE_STATUSES])
        .lt('updated_at', runCutoff)
      return (skip.length ? q.not('id', 'in', inList(skip)) : q).select('id')
    }),
    count('concepts', () => {
      const q = supabase
        .from('design_concepts')
        .update({ status: 'error', error: 'Concept timed out (swept by cron)', updated_at: stamp })
        .in('status', [...CONCEPT_ACTIVE_STATUSES])
        .lt('updated_at', runCutoff)
      return (skip.length ? q.not('run_id', 'in', inList(skip)) : q).select('id')
    }),
  ])
  return { inputs, runs, concepts }
}
