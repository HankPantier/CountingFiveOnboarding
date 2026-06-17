import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { buildMbpDocument } from '@/lib/mbp/build-document'
import { generateMbpJson } from '@/lib/mbp/generate-json'
import type { SessionSchema } from '@/types/session-schema'
import type { MbpChangeOp, MbpSuggestionChanges } from '@/types/mbp'

// Narrative/identity fields worth deriving from existing content. Excludes:
// factual/external sections (technical = WHOIS, sitemaps, contact PII, assets)
// where invention would be wrong; team.* (per-member bios) which can't be
// grounded without inventing; and services.*.offerings (per-service line items)
// — both are better filled via the inline editor than auto-derived.
const DERIVABLE_PREFIXES = ['business.', 'culture.', 'brand.']
const MAX_PAGE_CHARS = 12000
// Bound the response so it can't blow past the model's output budget and
// truncate the JSON mid-stream. Re-running picks up any remainder (deduped).
const MAX_TARGETS = 30

interface BackfillChange {
  fieldPath: string
  op: MbpChangeOp
  proposedValue: string
  rationale: string
}

function parseBackfill(parsed: unknown): { changes: BackfillChange[] } | null {
  if (!parsed || typeof parsed !== 'object') return null
  const raw = Array.isArray((parsed as Record<string, unknown>).changes)
    ? ((parsed as Record<string, unknown>).changes as unknown[])
    : []
  const changes: BackfillChange[] = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(c => typeof c.fieldPath === 'string' && typeof c.proposedValue === 'string')
    .map(c => ({
      fieldPath: c.fieldPath as string,
      op: c.op === 'append' ? 'append' : 'set',
      proposedValue: c.proposedValue as string,
      rationale: typeof c.rationale === 'string' ? c.rationale : '',
    }))
  return { changes }
}

// Derive values for empty MBP fields from information already present in the
// profile AND from the content we've actually produced (generated page copy),
// so the MBP reflects the latest articulation rather than the initial intake.
// Queues each as a pending suggestion for admin review — never writes
// schema_data directly, never invents facts.
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
  const allTargets = emptyFields.filter(f => DERIVABLE_PREFIXES.some(p => f.fieldPath.startsWith(p)))
  if (allTargets.length === 0) return { created: 0 }
  if (allTargets.length > MAX_TARGETS) {
    console.warn(`[mbp-backfill] ${allTargets.length} empty fields; capping to ${MAX_TARGETS} this run (re-run for the rest)`)
  }
  const targets = allTargets.slice(0, MAX_TARGETS)

  // The content we've actually produced — the richest, latest articulation of
  // the firm — as a primary derivation source.
  const { data: job } = await supabase
    .from('content_jobs')
    .select('id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let producedContent = ''
  if (job) {
    const { data: pages } = await supabase
      .from('generated_pages')
      .select('page_url, content_markdown')
      .eq('content_job_id', job.id)
    producedContent = (pages ?? [])
      .filter(p => (p.content_markdown ?? '').trim())
      .map(p => `## ${p.page_url}\n${p.content_markdown}`)
      .join('\n\n')
      .slice(0, MAX_PAGE_CHARS)
  }

  const { _meta, ...schemaForModel } = schema as Record<string, unknown>
  void _meta

  const result = await generateMbpJson<{ changes: BackfillChange[] }>(
    `You are completing a CPA firm's Master Business Profile (MBP). Rich detail already exists in some profile fields (positioning statement, niches, services, tagline, team) and in the website copy already produced for this firm. Several granular MBP fields are still empty.

CURRENT PROFILE (JSON):
${JSON.stringify(schemaForModel, null, 2)}

${producedContent ? `PRODUCED WEBSITE CONTENT (the latest, best articulation of this firm — prefer this when it conflicts with the older profile):\n"""\n${producedContent}\n"""\n` : ''}
EMPTY FIELDS TO TRY TO FILL (fieldPath — label):
${targets.map(t => `- ${t.fieldPath} — ${t.label}`).join('\n')}

For each empty field you can confidently fill USING ONLY information already present above, return a change. Rules:
- Derive strictly from the profile and produced content. NEVER invent facts, numbers, dates, or names not supported by the data. If a field can't be derived (e.g. a founding year stated nowhere), skip it.
- For scalar/prose fields use op "set" with proposedValue as the derived text.
- For array fields (e.g. a service's offerings) use op "append" with proposedValue as a JSON string (a quoted string for a simple list item).
- Keep each proposedValue CONCISE — 1-3 sentences for prose, a short item for lists. Keep each rationale to one short phrase.

Return ONLY JSON:
{ "changes": [ { "fieldPath": "...", "op": "set" | "append", "proposedValue": "...", "rationale": "..." } ] }`,
    parseBackfill,
    8000,
    { task: 'onboarding', stage: 'mbp', sessionId }
  )

  if (!result || result.changes.length === 0) return { created: 0 }

  let created = 0
  for (const c of result.changes) {
    if (!targets.some(t => t.fieldPath === c.fieldPath)) continue

    const changes: MbpSuggestionChanges = {
      [c.fieldPath]: { op: c.op, proposedValue: c.proposedValue, rationale: c.rationale },
    }
    // Include the proposed item for appends so distinct new array entries
    // each get their own pending slot (a 'set' re-proposal still supersedes).
    const keyParts = c.op === 'append'
      ? `${c.fieldPath}|append|${c.proposedValue}`
      : `${c.fieldPath}|set`
    const dedupeKey = createHash('sha256')
      .update(`${sessionId}|backfill|${keyParts}`)
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
      source_ref: producedContent ? 'profile + produced content' : 'existing profile data',
      changes: asJson(changes),
      summary: `Fill ${c.fieldPath}`,
      status: 'pending',
      dedupe_key: dedupeKey,
    })
    if (error) console.error('[mbp-backfill] insert failed:', error)
    else created += 1
  }

  return { created }
}
