import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { generatePassword } from '@/lib/auth/generate-password'
import type { SetPasswordResponse } from '@/types/users'

export const runtime = 'nodejs'

// Admin-set password: generates a strong random password and applies it
// immediately via the service-role admin API, returning it once for the admin
// to copy and hand off out-of-band. No email or redirect link involved.
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
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const password = generatePassword()
  const { error } = await supabase.auth.admin.updateUserById(id, { password })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json<SetPasswordResponse>({ password })
}
