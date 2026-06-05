import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../../_helpers'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
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
  // Scope to this job so a generation from another session can't be deleted.
  const { error } = await supabase
    .from('oneoff_generations')
    .delete()
    .eq('id', genId)
    .eq('content_job_id', ctx.jobId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
