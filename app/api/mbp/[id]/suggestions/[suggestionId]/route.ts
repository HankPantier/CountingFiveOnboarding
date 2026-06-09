import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { applyMbpUpdate } from '@/lib/mbp/apply-update'
import type { SessionSchema } from '@/types/session-schema'
import type { MbpSuggestionChanges, SuggestionActionBody } from '@/types/mbp'

export const runtime = 'nodejs'

function getByPath(schema: SessionSchema, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, schema as Record<string, unknown>)
}

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

    // For append ops we need the current array to push onto.
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', id)
      .single()
    const currentSchema = (sessionRow?.schema_data ?? {}) as SessionSchema

    const updates: Record<string, unknown> = {}
    for (const [fieldPath, change] of Object.entries(changes)) {
      if (change.op === 'append') {
        let item: unknown = change.proposedValue
        if (typeof change.proposedValue === 'string') {
          try { item = JSON.parse(change.proposedValue) } catch { item = change.proposedValue }
        }
        const existing = getByPath(currentSchema, fieldPath)
        const base = Array.isArray(existing) ? existing : []
        updates[fieldPath] = [...base, item]
      } else {
        updates[fieldPath] = change.proposedValue
      }
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
