import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Generic progress poll for any task_progress row. Gated by the row's session
// via requireSessionAccess (admin/manager/editor) — the id itself is an
// unguessable client-generated UUID, but we still scope to session access.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: row } = await supabase
    .from('task_progress')
    .select('kind, session_id, state, phase, current, total, message')
    .eq('id', id)
    .maybeSingle()

  // 404 until the worker writes the first row — the client treats this as
  // "not started yet" and keeps polling.
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!row.session_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const auth = await requireSessionAccess(row.session_id)
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({
    kind: row.kind,
    state: row.state,
    phase: row.phase,
    current: row.current,
    total: row.total,
    message: row.message,
  })
}
