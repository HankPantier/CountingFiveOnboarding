// The single sign-in link type our recovery/invite emails point at. Both are
// EmailOtpType values, so they're accepted by supabase.auth.verifyOtp.
export type ConfirmLinkType = 'recovery' | 'invite'

// Build a link to our own /auth/confirm route rather than emailing Supabase's
// raw verify-endpoint `action_link`. That action_link carries a `redirect_to`
// which GoTrue validates against the project's allow-list and rejects with
// "requested path is invalid" when it isn't listed — a per-environment config
// footgun. Pointing at /auth/confirm with the token hash keeps the whole flow
// on our own domain: the route calls verifyOtp (which doesn't use redirect_to)
// to establish the session, then forwards to `next`.
export function buildConfirmLink(
  hashedToken: string,
  type: ConfirmLinkType,
  next = '/admin/set-password'
): string {
  const url = new URL('/auth/confirm', process.env.NEXT_PUBLIC_APP_URL)
  url.searchParams.set('token_hash', hashedToken)
  url.searchParams.set('type', type)
  url.searchParams.set('next', next)
  return url.toString()
}
