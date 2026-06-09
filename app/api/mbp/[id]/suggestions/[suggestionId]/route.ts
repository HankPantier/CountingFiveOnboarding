import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { applyMbpUpdate } from '@/lib/mbp/apply-update'
import type { MbpSuggestionChanges, SuggestionActionBody } from '@/types/mbp'

export const runtime = 'nodejs'

// Approve (apply the proposed field changes) or dismiss a pending MBP
// suggestion. Admin-only — managers have a read-only MBP.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id, suggestionId } = await params

  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as SuggestionActionBody
  if (body.action !== 'approve' && body.action !== 'dismiss') {
    return NextResponse.json({ error: "action must be 'approve' or 'dismiss'" }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: suggestion } = await supabase
    .from('mbp_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('session_id', id)
    .maybeSingle()

  if (!suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  if (suggestion.status !== 'pending') {
    return NextResponse.json({ error: 'Suggestion is no longer pending' }, { status: 409 })
  }

  if (body.action === 'approve') {
    const changes = suggestion.changes as MbpSuggestionChanges
    const updates: Record<string, unknown> = {}
    for (const [fieldPath, change] of Object.entries(changes)) {
      updates[fieldPath] = change.proposedValue
    }
    const result = await applyMbpUpdate(supabase, id, updates)
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Failed to apply' }, { status: 500 })
    }
  }

  const { error: updateErr } = await supabase
    .from('mbp_suggestions')
    .update({
      status: body.action === 'approve' ? 'approved' : 'dismissed',
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
    })
    .eq('id', suggestionId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
