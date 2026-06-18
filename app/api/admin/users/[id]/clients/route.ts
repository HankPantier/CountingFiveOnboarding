import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import type { AssignedClient, UpdateAssignmentsRequest, UserAssignmentsResponse } from '@/types/users'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: links } = await supabase
    .from('manager_clients')
    .select('session_id')
    .eq('manager_id', id)

  const ids = (links ?? []).map(l => l.session_id)
  let assigned: AssignedClient[] = []
  if (ids.length > 0) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, website_url')
      .in('id', ids)
    assigned = (sessions ?? []).map(s => ({ session_id: s.id, website_url: s.website_url }))
  }

  return NextResponse.json<UserAssignmentsResponse>({ assigned })
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = (await req.json()) as UpdateAssignmentsRequest
  const next = Array.isArray(body.sessionIds)
    ? Array.from(new Set(body.sessionIds.filter(s => typeof s === 'string')))
    : null
  if (next === null) {
    return NextResponse.json({ error: 'sessionIds (array) required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: target } = await supabase
    .from('admins')
    .select('id, role, capabilities')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const isManager = target.role !== 'admin' && Array.isArray(target.capabilities) && target.capabilities.includes('manager')
  if (!isManager) {
    return NextResponse.json({ error: 'Only managers can be assigned clients' }, { status: 400 })
  }

  const { data: existingRows } = await supabase
    .from('manager_clients')
    .select('session_id')
    .eq('manager_id', id)
  const existing = new Set((existingRows ?? []).map(r => r.session_id))
  const nextSet = new Set(next)

  const toAdd = next.filter(s => !existing.has(s))
  const toRemove = [...existing].filter(s => !nextSet.has(s))

  if (toRemove.length > 0) {
    await supabase
      .from('manager_clients')
      .delete()
      .eq('manager_id', id)
      .in('session_id', toRemove)
  }
  if (toAdd.length > 0) {
    await supabase
      .from('manager_clients')
      .insert(toAdd.map(session_id => ({ manager_id: id, session_id })))
  }

  return NextResponse.json({ success: true })
}
