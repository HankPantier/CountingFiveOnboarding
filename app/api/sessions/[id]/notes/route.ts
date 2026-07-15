import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cap freeform call notes. A live-call note is long-form but not unbounded;
// 20k chars is generous (~3-4k words) and keeps the extraction prompt in budget.
const MAX_NOTES = 20000

// PATCH /api/sessions/[id]/notes — persist the rep's freeform call notes.
// Autosaved (debounced) from the onboarding notes screen. Rep-scoped: admins
// pass, managers only for an assigned client.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  let callNotes: string
  try {
    const body = (await req.json()) as { callNotes?: unknown }
    if (typeof body?.callNotes !== 'string') {
      return NextResponse.json({ error: 'callNotes must be a string' }, { status: 400 })
    }
    callNotes = body.callNotes.slice(0, MAX_NOTES)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('sessions')
    .update({ call_notes: callNotes })
    .eq('id', id)

  if (error) {
    console.error('[notes] save failed:', error)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
