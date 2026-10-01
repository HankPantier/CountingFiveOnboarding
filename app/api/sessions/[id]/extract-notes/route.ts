import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { applyNotesExtraction } from '@/lib/session-draft/apply-notes-extraction'
import { SessionNotFoundError } from '@/lib/session/schema-cas'

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
    .select('call_notes')
    .eq('id', id)
    .single()

  if (readErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const notes = (session.call_notes ?? '').trim()
  if (!notes) {
    return NextResponse.json({ error: 'No call notes to extract from' }, { status: 400 })
  }

  let applied: Awaited<ReturnType<typeof applyNotesExtraction>>
  try {
    applied = await applyNotesExtraction(
      supabase,
      id,
      notes,
      { task: 'onboarding', stage: 'mbp', sessionId: id },
      { stampExtractedAt: true },
    )
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    console.error('[extract-notes] write failed:', err)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }

  if (!applied) {
    return NextResponse.json({ error: 'Extraction failed — please try again' }, { status: 502 })
  }
  return NextResponse.json({ success: true, applied, appliedCount: applied.length })
}
