import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'

export const runtime = 'nodejs'

// Re-open the Sitemap phase so the admin can revise a confirmed sitemap. We keep
// confirmed_sitemap (GET serves it as the editable working set) and leave the
// downstream research/outline/generated rows in place — re-confirming via the
// sitemap POST already deletes and reseeds them.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { error } = await supabase
    .from('content_jobs')
    .update({ phase: 2, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.warn(`[content-job] sitemap un-approved, phase →2 job=${id}`)
  return NextResponse.json({ success: true })
}
