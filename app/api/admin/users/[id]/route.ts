import { NextResponse } from 'next/server'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser, type Role, type Capability } from '@/lib/auth/access'
import { contentReadySessionIds } from '@/lib/admin/content-ready'
import type { UpdateUserRequest } from '@/types/users'

export const runtime = 'nodejs'

const ALL_CAPABILITIES: Capability[] = ['manager', 'auditor', 'editor', 'owner']

function isRole(v: unknown): v is Role {
  return v === 'admin' || v === 'member'
}

function normalizeCapabilities(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return []
  return ALL_CAPABILITIES.filter(c => raw.includes(c))
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
  const body = await readJsonBody<UpdateUserRequest>(req)
  if (body instanceof NextResponse) return body
  const supabase = createServerClient()

  const { data: target } = await supabase
    .from('admins')
    .select('id, role, capabilities')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const update: { name?: string; role?: Role; capabilities?: Capability[] } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }

  // Resolve the final account tier (admin | member), guarding lockout.
  const finalRole: Role = body.role !== undefined ? (body.role as Role) : (target.role === 'admin' ? 'admin' : 'member')
  if (body.role !== undefined) {
    if (!isRole(body.role)) return NextResponse.json({ error: 'role must be admin or member' }, { status: 400 })
    // Guard against demoting the last admin or self-demotion (lockout).
    if (target.role === 'admin' && body.role !== 'admin') {
      if (id === auth.user.id) {
        return NextResponse.json({ error: 'You cannot demote yourself' }, { status: 400 })
      }
      if ((await adminCount(supabase)) <= 1) {
        return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
      }
    }
    update.role = body.role
  }

  // Admins implicitly hold every capability, so their explicit set is cleared.
  if (finalRole === 'admin') {
    if (update.role !== undefined || body.capabilities !== undefined) update.capabilities = []
  } else if (body.capabilities !== undefined || update.role !== undefined) {
    const caps = body.capabilities !== undefined
      ? normalizeCapabilities(body.capabilities)
      : normalizeCapabilities(target.capabilities)
    if (caps.length === 0) {
      return NextResponse.json({ error: 'A member needs at least one capability' }, { status: 400 })
    }
    if (caps.includes('manager') && caps.includes('editor')) {
      return NextResponse.json({ error: 'A member cannot be both manager and editor' }, { status: 400 })
    }
    if (caps.includes('owner') && caps.length > 1) {
      return NextResponse.json({ error: 'A Site Owner cannot hold other capabilities' }, { status: 400 })
    }
    // A Site Owner reaches exactly one site. Switching an existing multi-site
    // content member to owner would leave them able to open every assigned
    // editor by URL, so require they be reduced to a single site first (via
    // Manage access) — a fresh owner is created with one site through POST.
    // That single site must also be content-ready (phase ≥6 + repo), matching
    // POST /users and PUT /clients — otherwise the owner is dropped into an
    // editor that bounces them back with no admin surface to escape.
    if (caps.includes('owner')) {
      const { data: links } = await supabase
        .from('manager_clients')
        .select('session_id')
        .eq('manager_id', id)
      const sessionIds = (links ?? []).map(l => l.session_id)
      if (sessionIds.length > 1) {
        return NextResponse.json(
          { error: 'A Site Owner can be assigned only one site — reduce their client access to a single site before switching them to Site Owner' },
          { status: 400 },
        )
      }
      if (sessionIds.length === 1) {
        const ready = await contentReadySessionIds(sessionIds)
        if (!ready.has(sessionIds[0])) {
          return NextResponse.json(
            { error: 'A Site Owner can only be assigned a site whose content is ready — this member’s site is not published yet' },
            { status: 400 },
          )
        }
      }
    }
    update.capabilities = caps
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
  }

  const { error } = await supabase.from('admins').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-client assignments only mean something for a member holding a content
  // capability (manager or editor) — clear them once the user is an admin or
  // holds neither.
  const finalCaps = update.capabilities ?? normalizeCapabilities(target.capabilities)
  const keepsContentAccess = finalRole !== 'admin' && (finalCaps.includes('manager') || finalCaps.includes('editor') || finalCaps.includes('owner'))
  if (!keepsContentAccess) {
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
