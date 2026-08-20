import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
  }

  // Polled by the rep-facing ChatInterface (admin onboarding page only) — gate
  // it like every other session-scoped route rather than leaving it open.
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('sessions')
    .select('current_phase')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({ phase: data.current_phase })
}
