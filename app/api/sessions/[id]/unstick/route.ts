import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Force-clears the `processing` lock so a rep can recover a chat that got stuck
// on a mid-stream failure the callbacks couldn't unlock (e.g. a hard function
// kill). The in-request stale reclaim (3 min) and the streamText onError handler
// cover most cases; this is the manual escape hatch surfaced in the chat UI.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const { error: writeErr } = await supabase
    .from('sessions')
    .update({ processing: false })
    .eq('id', id)

  if (writeErr) {
    console.error('[unstick] write failed:', writeErr)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  console.warn(`[unstick] session=${id} cleared_by=${auth.user.id}`)

  return NextResponse.json({ ok: true })
}
