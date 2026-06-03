import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../../_helpers'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PatchBody {
  status?: 'approved' | 'dismissed' | 'suggested'
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; ideaId: string }> }
) {
  const { id, ideaId } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!UUID_RE.test(ideaId)) {
    return NextResponse.json({ error: 'Invalid idea id' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.status || !['approved', 'dismissed', 'suggested'].includes(body.status)) {
    return NextResponse.json({ error: 'status must be approved, dismissed, or suggested' }, { status: 400 })
  }

  const supabase = createServerClient()
  // Scope to this job so an idea id from another session can't be mutated.
  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('id, status, draft_status')
    .eq('id', ideaId)
    .eq('content_job_id', ctx.jobId)
    .single()
  if (!idea) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }
  if (idea.status === 'drafted') {
    return NextResponse.json({ error: 'Idea already drafted' }, { status: 409 })
  }
  if (idea.draft_status === 'running') {
    return NextResponse.json({ error: 'Draft in progress' }, { status: 409 })
  }

  const { error } = await supabase
    .from('resource_ideas')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('id', ideaId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
