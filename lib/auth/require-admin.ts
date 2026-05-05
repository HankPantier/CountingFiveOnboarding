import { NextResponse } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'

export async function requireAdmin(): Promise<{ user: { id: string; email?: string } } | NextResponse> {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return { user: { id: user.id, email: user.email ?? undefined } }
}
