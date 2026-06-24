import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
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
  // a link that establishes a session on the set-password page. ('invite'
  // would fail here since the auth user already exists.)
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/admin/set-password` },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    const message = linkErr?.message ?? 'Failed to generate invite link'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const isAdmin = target.role === 'admin'
  try {
    await sendInviteEmail({
      to: target.email,
      name: target.name,
      role: isAdmin ? 'admin' : 'member',
      capabilities: isAdmin
        ? []
        : (['manager', 'auditor'] as const).filter(c => Array.isArray(target.capabilities) && target.capabilities.includes(c)),
      inviteUrl: linkData.properties.action_link,
    })
  } catch (err) {
    console.error('[resend-invite] email failed:', err)
    return NextResponse.json({ error: 'Invite email failed to send' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
