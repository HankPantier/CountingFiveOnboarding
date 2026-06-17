import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { serializeSchemaFull } from '@/lib/agent/system-prompt'
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { getByPath } from '@/lib/mbp/schema-write'
import type { MbpChangeOp, MbpSuggestionChanges, MbpSuggestionOrigin } from '@/types/mbp'

export interface ImpactReviewInput {
  sessionId: string
  origin: MbpSuggestionOrigin
  sourceRef: string
  changedText: string
}

const CHANGED_TEXT_CAP = 4000

interface ReviewChange {
  fieldPath: string
  op: MbpChangeOp
  proposedValue: string
  rationale: string
}
interface ReviewResult {
  hasImpact: boolean
  changes: ReviewChange[]
  summary: string
}

function parseReview(parsed: unknown): ReviewResult | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const rawChanges = Array.isArray(p.changes) ? p.changes : []
  const changes: ReviewChange[] = rawChanges
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(c => typeof c.fieldPath === 'string' && typeof c.proposedValue === 'string')
    .map(c => ({
      fieldPath: c.fieldPath as string,
      op: c.op === 'append' ? 'append' : 'set',
      proposedValue: c.proposedValue as string,
      rationale: typeof c.rationale === 'string' ? c.rationale : '',
    }))
  return {
    hasImpact: p.hasImpact === true && changes.length > 0,
    changes,
    summary: typeof p.summary === 'string' ? p.summary : 'Suggested MBP update',
  }
}

// Background review (run via Next.js `after()` from content-mutation routes).
// Compares a content change against the current MBP and queues a pending
// suggestion if any prose/scalar MBP field should change. Never blocks the
// caller; never mutates the MBP (admins approve suggestions separately).
export async function reviewContentForMbpImpact(input: ImpactReviewInput): Promise<void> {
  const { sessionId, origin, sourceRef, changedText } = input
  if (!changedText?.trim()) return

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  if (!session) return

  const schema = (session.schema_data as Record<string, unknown>) ?? {}
  const mbpJson = serializeSchemaFull(session.schema_data ?? {})

  const result = await generateMbpJson<ReviewResult>(
    `You maintain a CPA firm's Master Business Profile (MBP) — the structured source of truth for their website.

CURRENT MBP (JSON):
${mbpJson}

A piece of content was just ${origin.replace('_', ' ')} (${sourceRef}):
"""
${changedText.slice(0, CHANGED_TEXT_CAP)}
"""

Decide whether this content reveals anything that should update the MBP to stay consistent — e.g. a new service, a new office/location, a shift in brand voice or positioning, a new differentiator.
- For prose/scalar fields (taglines, positioning statements, differentiators, brand tone fields, summaries): use op "set" with proposedValue as the new text.
- For NEW entries in an array field (a new service, office/location, or niche): use op "append", fieldPath as the array name (services, locations, niches), and proposedValue as a JSON string for the new array item matching the shape of the existing entries in that array (look at the MBP above for the exact keys). Do NOT propose replacing a whole array, and do NOT append a duplicate of something already present.
Only propose changes grounded in the content; if nothing warrants a change, return hasImpact false with an empty changes array.

Return ONLY JSON:
{ "hasImpact": boolean, "summary": "one-line summary", "changes": [ { "fieldPath": "...", "op": "set" | "append", "proposedValue": "...", "rationale": "..." } ] }`,
    parseReview,
    undefined,
    { task: 'onboarding', stage: 'mbp', sessionId }
  )

  if (!result || !result.hasImpact || result.changes.length === 0) return

  // Dedupe by field + op. For appends we also key on the proposed item so two
  // genuinely different new entries (e.g. two new services) each get their own
  // pending slot, while re-proposing the same one supersedes the prior.
  const signature = result.changes
    .map(c => `${c.fieldPath}:${c.op}${c.op === 'append' ? `:${c.proposedValue}` : ''}`)
    .sort()
    .join(',')
  const dedupeKey = createHash('sha256')
    .update(`${sessionId}|${signature}`)
    .digest('hex')

  const changes: MbpSuggestionChanges = {}
  for (const c of result.changes) {
    changes[c.fieldPath] = {
      op: c.op,
      currentValue: getByPath(schema, c.fieldPath),
      proposedValue: c.proposedValue,
      rationale: c.rationale,
    }
  }

  // Supersede any existing pending suggestion for the same field-set so
  // repeated edits don't stack (and to clear the partial-unique slot).
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
    changes: asJson(changes),
    summary: result.summary,
    status: 'pending',
    dedupe_key: dedupeKey,
  })
  if (error) console.error('[mbp-impact] insert failed:', error)
}
