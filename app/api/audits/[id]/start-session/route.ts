import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'

// POST /api/audits/[id]/start-session — create an onboarding session from the
// admin-reviewed AI draft and link it back to the audit. The websiteUrl is
// taken from the audit row (authoritative), not the client.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  let body: { schemaData?: unknown; gapList?: unknown }
  try {
    body = (await req.json()) as { schemaData?: unknown; gapList?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Light shape guard: a session needs an object schema + array gaps.
  if (!body.schemaData || typeof body.schemaData !== 'object' || Array.isArray(body.schemaData)) {
    return NextResponse.json({ error: 'Invalid schemaData' }, { status: 400 })
  }
  if (body.gapList !== undefined && !Array.isArray(body.gapList)) {
    return NextResponse.json({ error: 'Invalid gapList' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: run } = await supabase
    .from('audit_runs')
    .select('url, approved_at, session_id')
    .eq('id', id)
    .single()

  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (!run.approved_at) {
    return NextResponse.json({ error: 'Audit must be approved first' }, { status: 409 })
  }
  if (run.session_id) {
    return NextResponse.json({ error: 'A session was already started from this audit' }, { status: 409 })
  }

  // Mirrors POST /api/sessions: new session at phase 1, no MBP doc.
  const { data: session, error: insertErr } = await supabase
    .from('sessions')
    .insert({
      website_url: run.url,
      mbp_content: null,
      schema_data: asJson((body.schemaData ?? {}) as SessionSchema),
      gap_list: asJson((Array.isArray(body.gapList) ? body.gapList : []) as GapItem[]),
      status: 'pending',
      current_phase: 1,
    })
    .select('id')
    .single()

  if (insertErr || !session) {
    console.error('[audits] start-session create failed:', insertErr)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  // Atomic link: only succeeds if no session was linked since our guard read
  // (closes the TOCTOU window between two concurrent start-sessions). Postgres
  // serializes the row update, so the second request matches 0 rows.
  const { data: linked, error: linkErr } = await supabase
    .from('audit_runs')
    .update({ session_id: session.id })
    .eq('id', id)
    .is('session_id', null)
    .select('id')

  if (linkErr || !linked?.length) {
    // Lost the race (or link failed) — roll back the session we just created so
    // it isn't orphaned, and report the conflict.
    await supabase.from('sessions').delete().eq('id', session.id)
    if (linkErr) console.error('[audits] start-session link failed:', linkErr)
    return NextResponse.json(
      { error: 'A session was already started from this audit' },
      { status: 409 },
    )
  }

  return NextResponse.json({ sessionId: session.id })
}
