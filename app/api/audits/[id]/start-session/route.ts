import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { normalizeDomain } from '@/lib/audit'
import { promoteAuditGroupByDomain } from '@/lib/audit/audit-group'
import { withStaffMode } from '@/lib/session/seed-mode'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'

// POST /api/audits/[id]/start-session — create an onboarding session from the
// admin-reviewed AI draft and link it back to the audit. The websiteUrl is
// taken from the audit row (authoritative), not the client.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

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
    .select('url, approved_at, session_id, created_by')
    .eq('id', id)
    .single()

  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (!run.approved_at) {
    return NextResponse.json({ error: 'Audit must be approved first' }, { status: 409 })
  }
  if (run.session_id) {
    return NextResponse.json({ error: 'A session was already started from this audit' }, { status: 409 })
  }

  // Per-domain dedup: don't spin up a second session for a site that already
  // has a live (non-archived) session. website_url is stored raw, so normalize
  // both sides to compare by domain.
  const targetDomain = normalizeDomain(run.url)
  const { data: candidates } = await supabase
    .from('sessions')
    .select('id, website_url')
    .neq('status', 'archived')
  const existing = (candidates ?? []).find((s) => normalizeDomain(s.website_url) === targetDomain)
  if (existing) {
    return NextResponse.json(
      { error: `A session already exists for ${targetDomain}.`, existingSessionId: existing.id },
      { status: 409 },
    )
  }

  // Onboarding is rep-driven: seed staff mode so the agent addresses the rep,
  // not the client. Preserve any _meta the draft already carries (audit_context).
  const seededSchema = withStaffMode((body.schemaData ?? {}) as SessionSchema)

  // Mirrors POST /api/sessions: new session at phase 1, no MBP doc.
  const { data: session, error: insertErr } = await supabase
    .from('sessions')
    .insert({
      website_url: run.url,
      mbp_content: null,
      schema_data: asJson(seededSchema),
      gap_list: asJson((Array.isArray(body.gapList) ? body.gapList : []) as GapItem[]),
      status: 'pending',
      current_phase: 1,
      created_by: user.id,
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
    // it isn't orphaned, and report the conflict. Distinguish a same-audit race
    // from a concurrent same-domain race so the UI can still link out.
    await supabase.from('sessions').delete().eq('id', session.id)
    if (linkErr) console.error('[audits] start-session link failed:', linkErr)
    const { data: raceCandidates } = await supabase
      .from('sessions')
      .select('id, website_url')
      .neq('status', 'archived')
    const conflict = (raceCandidates ?? []).find(
      (s) => normalizeDomain(s.website_url) === targetDomain,
    )
    return NextResponse.json(
      conflict
        ? { error: `A session already exists for ${targetDomain}.`, existingSessionId: conflict.id }
        : { error: 'A session was already started from this audit' },
      { status: 409 },
    )
  }

  // The audit is now linked to a session — move this site's folder to 'working'
  // (forward-only, whole-domain). Non-fatal: never fail the start over it.
  await promoteAuditGroupByDomain(supabase, {
    domain: targetDomain,
    createdBy: run.created_by,
    to: 'working',
  })

  return NextResponse.json({ sessionId: session.id })
}
