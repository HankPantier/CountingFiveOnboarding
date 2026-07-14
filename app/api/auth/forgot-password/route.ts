import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendPasswordResetEmail } from '@/lib/email/send-password-reset'
import { buildConfirmLink } from '@/lib/auth/confirm-link'
import { checkRateLimit, clientIp } from '@/lib/auth/rate-limit'

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

  // Throttle: unauthenticated + sends email = amplification vector. When over
  // the limit, return the same success response — a 429 would leak that the
  // limiter tripped and break the enumeration-safety contract.
  const hour = 60 * 60 * 1000
  const [ipOk, emailOk] = await Promise.all([
    checkRateLimit(`forgot-password:ip:${clientIp(req)}`, 10, hour),
    checkRateLimit(`forgot-password:email:${email}`, 3, hour),
  ])
  if (!ipOk || !emailOk) {
    console.warn('[forgot-password] rate limited')
    return NextResponse.json({ success: true })
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
      })
      if (linkErr || !linkData?.properties?.hashed_token) {
        console.error('[forgot-password] failed to generate recovery link:', linkErr?.message)
      } else {
        const resetUrl = buildConfirmLink(linkData.properties.hashed_token, 'recovery')
        await sendPasswordResetEmail({ to: admin.email, resetUrl })
      }
    }
  } catch (err) {
    // Never surface failures to the caller — that would leak account existence.
    console.error('[forgot-password] unexpected error:', err)
  }

  return NextResponse.json({ success: true })
}
