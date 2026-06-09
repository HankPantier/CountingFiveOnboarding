import { createHash } from 'crypto'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { serializeSchemaFull } from '@/lib/agent/system-prompt'
import type { MbpSuggestionChanges, MbpSuggestionOrigin } from '@/types/mbp'

export interface ImpactReviewInput {
  sessionId: string
  origin: MbpSuggestionOrigin
  sourceRef: string
  changedText: string
}

const CHANGED_TEXT_CAP = 4000

const reviewSchema = z.object({
  hasImpact: z.boolean(),
  changes: z.array(z.object({
    fieldPath: z.string().describe('Dotted MBP path, e.g. business.tagline or brand.aspirationalTone'),
    proposedValue: z.string().describe('The proposed new value (text)'),
    rationale: z.string().describe('Why this content warrants the change'),
  })),
  summary: z.string(),
})

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
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

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: reviewSchema,
    prompt: `You maintain a CPA firm's Master Business Profile (MBP) — the structured source of truth for their website.

CURRENT MBP (JSON):
${mbpJson}

A piece of content was just ${origin.replace('_', ' ')} (${sourceRef}):
"""
${changedText.slice(0, CHANGED_TEXT_CAP)}
"""

Decide whether this content reveals anything that should update the MBP to stay consistent — e.g. a new service, a new office/location, a shift in brand voice or positioning, a new differentiator. Only propose changes to PROSE or SCALAR MBP fields (taglines, positioning statements, differentiators, brand tone fields, summaries) — do NOT propose edits to array fields like services/team/locations/niches (flag those in the summary instead). Only propose changes grounded in the content; if nothing warrants a change, return hasImpact: false with an empty changes array.`,
  })

  if (!object.hasImpact || object.changes.length === 0) return

  const fieldPaths = object.changes.map(c => c.fieldPath).sort()
  const dedupeKey = createHash('sha256')
    .update(`${sessionId}|${fieldPaths.join(',')}`)
    .digest('hex')

  const changes: MbpSuggestionChanges = {}
  for (const c of object.changes) {
    changes[c.fieldPath] = {
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
    summary: object.summary,
    status: 'pending',
    dedupe_key: dedupeKey,
  })
  if (error) console.error('[mbp-impact] insert failed:', error)
}
