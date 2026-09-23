import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const supabase = createServerClient()

  const { data: outlines, error } = await supabase
    .from('page_outlines')
    .select('*')
    .eq('content_job_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return internalError('outlines', error, "Couldn't load outlines")
  }

  return NextResponse.json({ outlines: outlines ?? [] })
}
