import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { buildConfirmLink } from '@/lib/auth/confirm-link'
import { sendInviteEmail } from '@/lib/email/send-invite'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: target } = await supabase
    .from('admins')
    .select('id, name, email, role, capabilities')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // 'recovery' works whether or not the invite was already accepted — it mints
  // a token hash we wrap in our own /auth/confirm link. ('invite' would fail
  // here since the auth user already exists.)
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
  })

  if (linkErr || !linkData?.properties?.hashed_token) {
    const message = linkErr?.message ?? 'Failed to generate invite link'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const inviteUrl = buildConfirmLink(linkData.properties.hashed_token, 'recovery')
  const isAdmin = target.role === 'admin'
  try {
    await sendInviteEmail({
      to: target.email,
      name: target.name,
      role: isAdmin ? 'admin' : 'member',
      capabilities: isAdmin
        ? []
        : (['manager', 'auditor'] as const).filter(c => Array.isArray(target.capabilities) && target.capabilities.includes(c)),
      inviteUrl,
    })
  } catch (err) {
    console.error('[resend-invite] email failed:', err)
    return NextResponse.json({ error: 'Invite email failed to send' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
