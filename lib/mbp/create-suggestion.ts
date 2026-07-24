import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { getByPath } from '@/lib/mbp/schema-write'
import type { MbpChangeOp, MbpSuggestionChanges, MbpSuggestionOrigin } from '@/types/mbp'

type Supabase = ReturnType<typeof createServerClient>

export interface SuggestionChangeInput {
  fieldPath: string
  op?: MbpChangeOp
  proposedValue: unknown
  rationale: string
}

export interface CreateSuggestionInput {
  sessionId: string
  origin: MbpSuggestionOrigin
  sourceRef?: string | null
  summary: string
  changes: SuggestionChangeInput[]
  // Current MBP, used to record each change's currentValue for the review UI.
  schema?: Record<string, unknown>
}

// Queue a pending MBP suggestion from an explicit set of changes. Mirrors the
// dedupe/supersede/insert used by the background impact review (impact-review.ts)
// so repeated proposals for the same field-set collapse to one pending slot.
// Never mutates schema_data — admins approve suggestions separately.
export async function insertMbpSuggestion(
  supabase: Supabase,
  input: CreateSuggestionInput
): Promise<{ filed: boolean }> {
  const { sessionId, origin, sourceRef = null, summary, changes, schema = {} } = input
  if (!changes.length) return { filed: false }

  // Dedupe by field + op. For appends we also key on the proposed item so two
  // genuinely different new entries each get their own slot, while re-proposing
  // the same one supersedes the prior.
  const signature = changes
    .map(c => {
      const op: MbpChangeOp = c.op === 'append' ? 'append' : 'set'
      return `${c.fieldPath}:${op}${op === 'append' ? `:${JSON.stringify(c.proposedValue)}` : ''}`
    })
    .sort()
    .join(',')
  const dedupeKey = createHash('sha256').update(`${sessionId}|${signature}`).digest('hex')

  const changeMap: MbpSuggestionChanges = {}
  for (const c of changes) {
    changeMap[c.fieldPath] = {
      op: c.op === 'append' ? 'append' : 'set',
      currentValue: getByPath(schema, c.fieldPath),
      proposedValue: c.proposedValue,
      rationale: c.rationale,
    }
  }

  await supabase
    .from('mbp_suggestions')
    .update({ status: 'superseded', resolved_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('dedupe_key', dedupeKey)
    .eq('status', 'pending')

  const { error } = await supabase.from('mbp_suggestions').insert({
    session_id: sessionId,
    origin,
    source_ref: sourceRef,
    changes: asJson(changeMap),
    summary,
    status: 'pending',
    dedupe_key: dedupeKey,
  })
  if (error) {
    console.error('[mbp-suggestion] insert failed:', error.message)
    return { filed: false }
  }
  return { filed: true }
}
