import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// A single progress update: a human phase label plus an optional determinate
// count. total === 0 means "indeterminate" (the UI shows a sliding bar + timer).
export type ProgressTick = { phase: string; current: number; total: number }

export type ProgressWriter = {
  start: (phase: string) => Promise<void>
  tick: (p: ProgressTick) => Promise<void>
  finish: (message: string) => Promise<void>
  error: (message: string) => Promise<void>
}

// Server-side writer for a task_progress row, keyed by a CLIENT-generated id so
// a concurrently-polling client sees updates while the work request is still in
// flight. Every write is best-effort (upsert, errors swallowed) — progress
// bookkeeping must never fail the underlying operation. Service-role client
// only; the table is RLS-locked and app-gated (see migration 057).
export function makeProgressWriter(
  supabase: SupabaseClient<Database>,
  taskId: string,
  meta: { kind: string; sessionId: string; contentJobId: string; createdBy?: string | null }
): ProgressWriter {
  const base = {
    id: taskId,
    kind: meta.kind,
    session_id: meta.sessionId,
    content_job_id: meta.contentJobId,
    created_by: meta.createdBy ?? null,
  }
  const upsert = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from('task_progress')
      .upsert({ ...base, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) console.warn(`[task-progress] upsert failed for ${taskId}: ${error.message}`)
  }
  return {
    start: (phase) => upsert({ state: 'running', phase, current: 0, total: 0, message: null }),
    tick: (p) => upsert({ state: 'running', phase: p.phase, current: p.current, total: p.total }),
    finish: (message) => upsert({ state: 'done', message }),
    error: (message) => upsert({ state: 'error', message }),
  }
}
