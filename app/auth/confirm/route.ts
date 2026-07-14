import { type NextRequest, NextResponse } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'
import type { ConfirmLinkType } from '@/lib/auth/confirm-link'

export const runtime = 'nodejs'

const VALID_TYPES: ConfirmLinkType[] = ['recovery', 'invite']

// Consumes the single-use recovery/invite link. verifyOtp exchanges the token
// hash for a session (written to cookies by createAuthClient), then we forward
// to the set-password page. This runs on our own domain, so it sidesteps the
// GoTrue redirect_to allow-list entirely.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const nextParam = searchParams.get('next') ?? '/admin/set-password'

  // Same-site relative redirects only — never honor an absolute or //-prefixed
  // `next`, which would be an open-redirect.
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/admin/set-password'

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin

  if (tokenHash && type && (VALID_TYPES as string[]).includes(type)) {
    const supabase = await createAuthClient()
    const { error } = await supabase.auth.verifyOtp({
      type: type as ConfirmLinkType,
      token_hash: tokenHash,
    })
    if (!error) {
      return NextResponse.redirect(new URL(next, base))
    }
  }

  return NextResponse.redirect(new URL('/admin/login?error=invalid_or_expired_link', base))
}
