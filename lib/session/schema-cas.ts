import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type SessionRow = Database['public']['Tables']['sessions']['Row']
type SessionUpdate = Database['public']['Tables']['sessions']['Update']

// The columns a schema read-modify-write needs. Kept to a fixed set so the
// retry loop never pulls the large text columns (mfp_content, call notes).
const CAS_COLUMNS =
  'id, status, current_phase, website_url, schema_data, gap_list, schema_version'

export type CasSessionRow = Pick<
  SessionRow,
  'id' | 'status' | 'current_phase' | 'website_url' | 'schema_data' | 'gap_list' | 'schema_version'
>

// schema_version is owned by the database trigger (migration 077); callers
// never write it.
export type CasSessionUpdate = Omit<SessionUpdate, 'schema_version' | 'id'>

export type CasOutcome<R> = { update: CasSessionUpdate; result: R } | { skip: true; result: R }

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} not found`)
    this.name = 'SessionNotFoundError'
  }
}

export class SchemaConflictError extends Error {
  constructor(sessionId: string, attempts: number) {
    super(`Session ${sessionId} kept changing; gave up after ${attempts} attempts`)
    this.name = 'SchemaConflictError'
  }
}

// Optimistic compare-and-swap write for sessions.schema_data / gap_list.
//
// Reads the row, lets `compute` derive the update from that fresh copy, and
// writes only if schema_version is still what was read. On a miss another
// writer landed in between, so the row is re-read and `compute` runs again on
// the new state — nothing it didn't see is ever overwritten.
//
// `compute` may run more than once: keep it a pure function of the row (do any
// AI call or other slow work BEFORE calling this, and pass the result in).
export async function updateSessionWithCas<R>(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  compute: (row: CasSessionRow) => CasOutcome<R> | Promise<CasOutcome<R>>,
  opts: { attempts?: number } = {}
): Promise<R> {
  const attempts = opts.attempts ?? 5
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { data: row, error: readErr } = await supabase
      .from('sessions')
      .select(CAS_COLUMNS)
      .eq('id', sessionId)
      .maybeSingle()
    if (readErr) throw readErr
    if (!row) throw new SessionNotFoundError(sessionId)

    const outcome = await compute(row)
    if ('skip' in outcome) return outcome.result

    const { data: written, error: writeErr } = await supabase
      .from('sessions')
      .update(outcome.update)
      .eq('id', sessionId)
      .eq('schema_version', row.schema_version)
      .select('id')
    if (writeErr) throw writeErr
    if (written && written.length > 0) return outcome.result

    if (attempt < attempts) {
      await new Promise(r => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 50)))
    }
  }
  throw new SchemaConflictError(sessionId, attempts)
}
