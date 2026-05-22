import { NextResponse } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'

export async function requireAdmin(): Promise<{ user: { id: string; email?: string } } | NextResponse> {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Authorization gate: a valid Supabase session is not enough — the user
  // must be enrolled in the `admins` table. The existing self-read policy
  // on `admins` (migration 001) lets the auth client read its own row.
  const { data: admin } = await supabase
    .from('admins')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { user: { id: user.id, email: user.email ?? undefined } }
}
