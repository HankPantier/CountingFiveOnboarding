import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser, type Role } from '@/lib/auth/access'
import type { UpdateUserRequest } from '@/types/users'

export const runtime = 'nodejs'

function isRole(v: unknown): v is Role {
  return v === 'admin' || v === 'manager'
}

async function adminCount(supabase: ReturnType<typeof createServerClient>): Promise<number> {
  const { count } = await supabase
    .from('admins')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
  return count ?? 0
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = (await req.json()) as UpdateUserRequest
  const supabase = createServerClient()

  const { data: target } = await supabase
    .from('admins')
    .select('id, role')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const update: { name?: string; role?: Role } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }

  if (body.role !== undefined) {
    if (!isRole(body.role)) return NextResponse.json({ error: 'role must be admin or manager' }, { status: 400 })
    // Guard against demoting the last admin or self-demotion (lockout).
    if (target.role === 'admin' && body.role === 'manager') {
      if (id === auth.user.id) {
        return NextResponse.json({ error: 'You cannot demote yourself' }, { status: 400 })
      }
      if ((await adminCount(supabase)) <= 1) {
        return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
      }
    }
    update.role = body.role
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
  }

  const { error } = await supabase.from('admins').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Promotion to admin makes per-client assignments meaningless — clear them.
  if (update.role === 'admin') {
    await supabase.from('manager_clients').delete().eq('manager_id', id)
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (id === auth.user.id) {
    return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: target } = await supabase
    .from('admins')
    .select('id, role')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (target.role === 'admin' && (await adminCount(supabase)) <= 1) {
    return NextResponse.json({ error: 'Cannot delete the last admin' }, { status: 400 })
  }

  // Delete the auth user first — if this fails we keep the admins row intact
  // rather than orphaning a login that could be re-invited. (CASCADE on
  // manager_clients clears assignments when the admins row goes.)
  const { error: authErr } = await supabase.auth.admin.deleteUser(id)
  if (authErr) {
    console.error('[DELETE /api/admin/users] auth user delete failed', authErr)
    return NextResponse.json({ error: 'Failed to remove the user account' }, { status: 500 })
  }

  const { error: delErr } = await supabase.from('admins').delete().eq('id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
