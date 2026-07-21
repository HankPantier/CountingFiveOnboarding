import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Poll the status of an AI first-draft generation. Scoped to the session's
// content job so one client can't read another's generation rows.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; genId: string }> }
) {
  const { id, genId } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  if (!UUID_RE.test(genId)) {
    return NextResponse.json({ error: 'Invalid generation id' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('new_page_generations')
    .select('id, page_url, target_path, status, error')
    .eq('id', genId)
    .eq('content_job_id', ctx.jobId)
    .single()
  if (error || !data) {
    return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
  }

  return NextResponse.json({ generation: data })
}
