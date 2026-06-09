import { NextResponse } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'

// Non-throwing companion to requireAdmin(): returns { isAdmin } so the chat UI
// can decide whether to render the staff-mode toggle without console-erroring
// for every unauthenticated client session.
export async function GET() {
  try {
    const supabase = await createAuthClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ isAdmin: false })
    }

    const { data: admin } = await supabase
      .from('admins')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle()

    return NextResponse.json({
      isAdmin: !!admin,
      role: admin?.role ?? null,
    })
  } catch {
    return NextResponse.json({ isAdmin: false })
  }
}
