import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const supabase = createServerClient()

  // Only approve outlines that have actually been generated (h1 set). Rows
  // still generating (h1 null) are left untouched so we never approve an
  // empty outline.
  const { data, error } = await supabase
    .from('page_outlines')
    .update({ admin_approved: true, updated_at: new Date().toISOString() })
    .eq('content_job_id', id)
    .not('h1', 'is', null)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ approved: data?.length ?? 0 })
}
