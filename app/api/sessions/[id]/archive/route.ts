import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'

// Soft-archive toggle. Archived sessions keep all data but drop out of the
// default dashboard list and the inactivity-reminder cron (status filter).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  let body: { archived?: boolean }
  try {
    body = (await req.json()) as { archived?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.archived !== 'boolean') {
    return NextResponse.json({ error: 'archived (boolean) required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('id, status, current_phase')
    .eq('id', id)
    .single()
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Restore derives status from phase (mirrors statusForPhase in the chat
  // route); approved state can't be derived, so restores land on completed
  // and the admin re-approves if needed.
  const status = body.archived
    ? 'archived'
    : session.current_phase === 7
      ? 'completed'
      : session.current_phase === 0
        ? 'pending'
        : 'in_progress'

  const { error } = await supabase.from('sessions').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, status })
}
