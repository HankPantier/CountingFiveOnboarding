import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { getByPath } from '@/lib/mbp/schema-write'
import { isApprovableSuggestionPath, isWholeArraySet } from '@/lib/mbp/suggestion-guards'
import type { MbpChangeOp, MbpSuggestionChanges, MbpSuggestionOrigin } from '@/types/mbp'

type Supabase = ReturnType<typeof createServerClient>

export interface SuggestionChangeInput {
  fieldPath: string
  op?: MbpChangeOp
  proposedValue: unknown
  rationale: string
  // Snapshot this path's current value as the approval guard (see
  // MbpSuggestionBase) — e.g. `niches[2].name` for a drop of niches[2]. Whole-
  // array sets are guarded on their own path automatically.
  basePath?: string
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
): Promise<{ filed: boolean; error?: string }> {
  const { sessionId, origin, sourceRef = null, summary, schema = {} } = input
  // Server-owned `_meta` markers (and off-schema paths) are never suggestible —
  // the approve route skips them too, but refusing here keeps them out of the
  // review panel entirely.
  const rejected = input.changes.filter(c => !isApprovableSuggestionPath(c.fieldPath)).map(c => c.fieldPath)
  const changes = input.changes.filter(c => isApprovableSuggestionPath(c.fieldPath))
  if (!changes.length) {
    return { filed: false, ...(rejected.length ? { error: `Not an editable profile field: ${rejected.join(', ')}` } : {}) }
  }

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
    const op: MbpChangeOp = c.op === 'append' ? 'append' : 'set'
    const currentValue = getByPath(schema, c.fieldPath)
    const basePath = c.basePath ?? (isWholeArraySet(op, c.proposedValue, currentValue) ? c.fieldPath : undefined)
    changeMap[c.fieldPath] = {
      op,
      currentValue,
      proposedValue: c.proposedValue,
      rationale: c.rationale,
      ...(basePath ? { base: { path: basePath, value: getByPath(schema, basePath) ?? null } } : {}),
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
