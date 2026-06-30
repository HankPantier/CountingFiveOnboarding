import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { NextResponse } from 'next/server'

// Admin override to force a session to the completed state. Needed when the chat
// agent never fired the final advancePhase tool call (model behavior), leaving a
// finished conversation stuck at an earlier phase — which otherwise blocks Approve
// and content generation. Marking complete surfaces the existing Approve flow.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'approved') {
    return NextResponse.json({ error: 'Session already approved' }, { status: 409 })
  }
  if (session.status === 'completed') {
    return NextResponse.json({ error: 'Session already completed' }, { status: 409 })
  }
  if (session.status === 'archived') {
    return NextResponse.json({ error: 'Restore the session before completing it' }, { status: 400 })
  }

  const { error } = await supabase
    .from('sessions')
    .update({
      status: 'completed',
      current_phase: 7,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    console.error('[Complete]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
