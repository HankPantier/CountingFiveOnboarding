import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendPasswordResetEmail } from '@/lib/email/send-password-reset'

export const runtime = 'nodejs'

interface ForgotPasswordRequest {
  email?: string
}

// Public (pre-login) self-service password reset. Enumeration-safe: it always
// responds { success: true } regardless of whether the email belongs to an
// admin or whether the email send succeeds, so the response can't be used to
// probe which addresses have accounts. Mirrors the recovery-link pattern in
// app/api/admin/users/[id]/resend-invite/route.ts, minus the admin gate.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ForgotPasswordRequest
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  try {
    const supabase = createServerClient()
    const { data: admin } = await supabase
      .from('admins')
      .select('email')
      .ilike('email', email)
      .maybeSingle()

    if (admin) {
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: admin.email,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/admin/set-password` },
      })
      if (linkErr || !linkData?.properties?.action_link) {
        console.error('[forgot-password] failed to generate recovery link:', linkErr?.message)
      } else {
        await sendPasswordResetEmail({ to: admin.email, resetUrl: linkData.properties.action_link })
      }
    }
  } catch (err) {
    // Never surface failures to the caller — that would leak account existence.
    console.error('[forgot-password] unexpected error:', err)
  }

  return NextResponse.json({ success: true })
}
