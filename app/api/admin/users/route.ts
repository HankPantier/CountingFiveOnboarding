import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser, type Role, type Capability } from '@/lib/auth/access'
import { sendInviteEmail } from '@/lib/email/send-invite'
import type {
  CreateUserRequest,
  CreateUserResponse,
  ListUsersResponse,
  UserSummary,
} from '@/types/users'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALL_CAPABILITIES: Capability[] = ['manager', 'auditor']

function isRole(v: unknown): v is Role {
  return v === 'admin' || v === 'member'
}

// Keep only known capabilities, in canonical order.
function normalizeCapabilities(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return []
  return ALL_CAPABILITIES.filter(c => raw.includes(c))
}

export async function GET() {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const [{ data: admins, error }, { data: links }] = await Promise.all([
    supabase.from('admins').select('id, name, email, role, capabilities, created_at').order('created_at', { ascending: true }),
    supabase.from('manager_clients').select('manager_id'),
  ])

  if (error) {
    console.error('[GET /api/admin/users]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const countByManager = new Map<string, number>()
  for (const l of links ?? []) {
    countByManager.set(l.manager_id, (countByManager.get(l.manager_id) ?? 0) + 1)
  }

  const users: UserSummary[] = (admins ?? []).map(a => {
    const isAdmin = a.role === 'admin'
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      role: isAdmin ? 'admin' : 'member',
      capabilities: isAdmin ? ALL_CAPABILITIES : normalizeCapabilities(a.capabilities),
      created_at: a.created_at,
      assignedCount: countByManager.get(a.id) ?? 0,
    }
  })

  return NextResponse.json<ListUsersResponse>({ users })
}

export async function POST(req: Request) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json()) as Partial<CreateUserRequest>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role
  const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.filter(s => typeof s === 'string') : []

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  if (!isRole(role)) return NextResponse.json({ error: 'role must be admin or member' }, { status: 400 })

  // Admins implicitly hold every capability, so only members carry an explicit set.
  const capabilities = role === 'admin' ? [] : normalizeCapabilities(body.capabilities)
  if (role === 'member' && capabilities.length === 0) {
    return NextResponse.json({ error: 'A member needs at least one capability' }, { status: 400 })
  }
  const isManager = capabilities.includes('manager')

  const supabase = createServerClient()

  // Mint an invite link (also creates the auth user) — we deliver it via
  // Resend rather than Supabase SMTP for full control over the email.
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/admin/set-password` },
  })

  if (linkErr || !linkData?.user || !linkData.properties?.action_link) {
    const message = linkErr?.message ?? 'Failed to create user'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const userId = linkData.user.id

  const { error: insertErr } = await supabase
    .from('admins')
    .insert({ id: userId, name, email, role, capabilities })

  if (insertErr) {
    // Roll back the orphaned auth user so a retry can re-create cleanly.
    await supabase.auth.admin.deleteUser(userId)
    console.error('[POST /api/admin/users] admins insert failed', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  if (isManager && sessionIds.length > 0) {
    const rows = sessionIds.map(session_id => ({ manager_id: userId, session_id }))
    const { error: linkInsertErr } = await supabase.from('manager_clients').insert(rows)
    if (linkInsertErr) {
      console.error('[POST /api/admin/users] assignment insert failed', linkInsertErr)
    }
  }

  // The auth user + admins row are already committed; a Resend failure must not
  // fail the request (a retry can't cleanly recreate them). Surface emailSent so
  // the admin can recover via the resend-invite action.
  let emailSent = true
  try {
    await sendInviteEmail({
      to: email,
      name,
      role,
      capabilities,
      inviteUrl: linkData.properties.action_link,
    })
  } catch (err) {
    emailSent = false
    console.error('[POST /api/admin/users] invite email failed (user created):', err)
  }

  return NextResponse.json<CreateUserResponse>({ id: userId, emailSent })
}
