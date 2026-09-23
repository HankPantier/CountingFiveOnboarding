import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { refreshPhase4Gaps } from '@/lib/agent/gap-tiering'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { extractNotesModel, mergeNotesExtraction } from '@/lib/session-draft/extract-from-notes'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/sessions/[id]/extract-notes — parse the rep's call notes into the
// profile (non-destructive: only blank fields are filled) and recompute gaps.
// Returns the applied diff for the rep to review. Rep-scoped.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data: session, error: readErr } = await supabase
    .from('sessions')
    .select('schema_data, gap_list, call_notes')
    .eq('id', id)
    .single()

  if (readErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const notes = (session.call_notes ?? '').trim()
  if (!notes) {
    return NextResponse.json({ error: 'No call notes to extract from' }, { status: 400 })
  }

  const schema = (session.schema_data as SessionSchema | null) ?? {}
  const gaps = (session.gap_list as GapItem[] | null) ?? []

  const model = await extractNotesModel(notes, schema, gaps, {
    task: 'onboarding',
    stage: 'mbp',
    sessionId: id,
  })

  if (!model) {
    return NextResponse.json({ error: 'Extraction failed — please try again' }, { status: 502 })
  }

  // The extraction call is long; re-read right before the write and apply the
  // (blank-fill-only) merge onto the FRESH row so an edit made meanwhile — a
  // chat turn, an inline field edit — isn't overwritten by the stale snapshot.
  const { data: fresh, error: freshErr } = await supabase
    .from('sessions')
    .select('schema_data, gap_list')
    .eq('id', id)
    .single()
  if (freshErr || !fresh) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  const freshSchema = (fresh.schema_data as SessionSchema | null) ?? {}
  const freshGaps = (fresh.gap_list as GapItem[] | null) ?? []

  const { schema: mergedSchema, gaps: extractedGaps, applied } = mergeNotesExtraction(freshSchema, freshGaps, model)
  // Notes can add niches/services — give them their Phase-4 depth gaps.
  const mergedGaps = refreshPhase4Gaps(mergedSchema, extractedGaps)

  const { error: writeErr } = await supabase
    .from('sessions')
    .update({
      schema_data: asJson(mergedSchema),
      gap_list: asJson(mergedGaps),
      notes_extracted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (writeErr) {
    console.error('[extract-notes] write failed:', writeErr)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, applied, appliedCount: applied.length })
}
