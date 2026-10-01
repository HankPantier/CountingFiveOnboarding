import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import type { TokenContext } from '@/lib/content/token-pricing'
import { refreshPhase4Gaps } from '@/lib/agent/gap-tiering'
import { asJson } from '@/lib/supabase/json-typed'
import { updateSessionWithCas, type CasSessionUpdate } from '@/lib/session/schema-cas'
import { extractNotesModel, mergeNotesExtraction, type AppliedField } from './extract-from-notes'

// Extracts MBP facts from call notes and blank-fills them onto the session. The
// extraction call is long, so it runs first on a snapshot; the merge then runs
// inside a compare-and-swap on the FRESH row, so an edit made meanwhile (a chat
// turn, an inline field edit) is re-read and kept, never overwritten.
// Returns null when the model produced no usable extraction.
export async function applyNotesExtraction(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  notes: string,
  ctx: TokenContext,
  opts: { stampExtractedAt?: boolean } = {},
): Promise<AppliedField[] | null> {
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data, gap_list')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return null

  const model = await extractNotesModel(
    notes,
    (session.schema_data as SessionSchema | null) ?? {},
    (session.gap_list as GapItem[] | null) ?? [],
    ctx,
  )
  if (!model) return null

  return updateSessionWithCas(supabase, sessionId, (fresh) => {
    const merged = mergeNotesExtraction(
      (fresh.schema_data as SessionSchema | null) ?? {},
      (fresh.gap_list as GapItem[] | null) ?? [],
      model,
    )
    // Notes can add niches/services — give them their Phase-4 depth gaps.
    const update: CasSessionUpdate = {
      schema_data: asJson(merged.schema),
      gap_list: asJson(refreshPhase4Gaps(merged.schema, merged.gaps)),
    }
    if (opts.stampExtractedAt) update.notes_extracted_at = new Date().toISOString()
    return { update, result: merged.applied }
  })
}
