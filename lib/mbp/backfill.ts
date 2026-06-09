import { createHash } from 'crypto'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { buildMbpDocument } from '@/lib/mbp/build-document'
import type { SessionSchema } from '@/types/session-schema'
import type { MbpSuggestionChanges } from '@/types/mbp'

// Sections worth deriving from existing narrative data. Excludes factual /
// external sections (technical = WHOIS, sitemaps = structural, contact = PII,
// assets) where invention would be wrong rather than helpful.
const DERIVABLE_PREFIXES = ['business.', 'culture.', 'brand.', 'team.', 'services.']

const backfillSchema = z.object({
  changes: z.array(z.object({
    fieldPath: z.string().describe('One of the empty field paths provided'),
    op: z.enum(['set', 'append']).describe("'set' for scalar/prose fields; 'append' for array fields"),
    proposedValue: z.string().describe("For set: the derived text. For append: a JSON object for the array item."),
    rationale: z.string().describe('Which existing profile content this was derived from'),
  })),
})

// Derive values for empty MBP fields from information already present
// elsewhere in the profile (positioning statement, niches, service
// descriptions, team). Queues each as a pending suggestion for admin review —
// never writes schema_data directly, never invents facts.
export async function backfillMbpFromProfile(
  sessionId: string
): Promise<{ created: number }> {
  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  if (!session) return { created: 0 }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const doc = buildMbpDocument(schema)

  const emptyFields: { fieldPath: string; label: string }[] = []
  for (const section of doc.sections) {
    for (const f of section.fields ?? []) {
      if (f.empty) emptyFields.push({ fieldPath: f.fieldPath, label: `${section.title} — ${f.label}` })
    }
    for (const item of section.items ?? []) {
      for (const f of item.fields) {
        if (f.empty) emptyFields.push({ fieldPath: f.fieldPath, label: `${section.title} / ${item.heading} — ${f.label}` })
      }
    }
  }
  const targets = emptyFields.filter(f => DERIVABLE_PREFIXES.some(p => f.fieldPath.startsWith(p)))
  if (targets.length === 0) return { created: 0 }

  const { _meta, ...schemaForModel } = schema as Record<string, unknown>
  void _meta

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: backfillSchema,
    prompt: `You are completing a CPA firm's Master Business Profile. Rich detail is already captured in some fields (especially the positioning statement, niches, service descriptions, tagline, and team), but several granular fields are still empty.

FULL PROFILE (JSON):
${JSON.stringify(schemaForModel, null, 2)}

EMPTY FIELDS TO TRY TO FILL (fieldPath — label):
${targets.map(t => `- ${t.fieldPath} — ${t.label}`).join('\n')}

For each empty field you can confidently fill USING ONLY information already present in the profile above, return a change. Rules:
- Derive strictly from existing content (positioning statement, niches, services, tagline, team). NEVER invent facts, numbers, dates, or names not supported by the data. If a field can't be derived (e.g. a founding year that's stated nowhere), skip it.
- For scalar/prose fields use op "set" with the derived text.
- For array fields (e.g. a service's offerings, a team member's specializations) use op "append" with proposedValue as a JSON value (a string for a simple list item, or a JSON object matching the array's item shape).
- Keep each value concise and on-brand. Cite your source in the rationale.
Return only the changes you are confident about.`,
  })

  if (!object.changes.length) return { created: 0 }

  let created = 0
  for (const c of object.changes) {
    // Only accept paths we actually offered (guard against drift).
    if (!targets.some(t => t.fieldPath === c.fieldPath)) continue

    const changes: MbpSuggestionChanges = {
      [c.fieldPath]: { op: c.op, proposedValue: c.proposedValue, rationale: c.rationale },
    }
    const dedupeKey = createHash('sha256')
      .update(`${sessionId}|backfill|${c.fieldPath}|${c.op}`)
      .digest('hex')

    await supabase
      .from('mbp_suggestions')
      .update({ status: 'superseded', resolved_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('dedupe_key', dedupeKey)
      .eq('status', 'pending')

    const { error } = await supabase.from('mbp_suggestions').insert({
      session_id: sessionId,
      origin: 'backfill',
      source_ref: 'existing profile data',
      changes: asJson(changes),
      summary: `Fill ${c.fieldPath} from existing profile`,
      status: 'pending',
      dedupe_key: dedupeKey,
    })
    if (error) console.error('[mbp-backfill] insert failed:', error)
    else created += 1
  }

  return { created }
}
