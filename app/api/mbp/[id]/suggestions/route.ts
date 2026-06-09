import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import type { MbpSuggestion } from '@/types/mbp'

export const runtime = 'nodejs'

// Pending MBP suggestions for a session. Admins + assigned managers may read
// (managers get a view-only list; only admins can act on them).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('mbp_suggestions')
    .select('*')
    .eq('session_id', id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/mbp/[id]/suggestions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ suggestions: (data ?? []) as unknown as MbpSuggestion[] })
}
