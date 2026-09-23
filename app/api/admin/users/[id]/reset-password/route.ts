import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { buildConfirmLink } from '@/lib/auth/confirm-link'
import type { ResetPasswordResponse } from '@/types/users'

export const runtime = 'nodejs'

// Admin-triggered password reset that RETURNS a single-use recovery link
// (rather than emailing it like resend-invite). The admin copies the link and
// delivers it out-of-band — useful when email delivery isn't available.
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
    .select('id, email')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // 'recovery' works whether or not the user has set a password before; it mints
  // a token hash we wrap in our own /auth/confirm link (see buildConfirmLink).
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
  })

  if (linkErr || !linkData?.properties?.hashed_token) {
    return internalError('admin-users:reset-password', linkErr ?? 'missing hashed_token', 'Failed to generate reset link')
  }

  const link = buildConfirmLink(linkData.properties.hashed_token, 'recovery')
  return NextResponse.json<ResetPasswordResponse>({ link })
}
