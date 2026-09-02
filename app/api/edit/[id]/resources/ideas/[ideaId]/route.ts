import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { isContentType } from '@/lib/content/content-types'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PatchBody {
  status?: 'approved' | 'dismissed' | 'suggested'
  // Re-classify the idea's content type (e.g. blog → article). Relabel only —
  // allowed even on an already-drafted idea; it changes the format rules a
  // future regenerate will use, not the existing committed draft.
  contentType?: string
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
  const hasStatus = body.status !== undefined
  const hasContentType = body.contentType !== undefined
  if (!hasStatus && !hasContentType) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  if (hasStatus && !['approved', 'dismissed', 'suggested'].includes(body.status as string)) {
    return NextResponse.json({ error: 'status must be approved, dismissed, or suggested' }, { status: 400 })
  }
  if (hasContentType && !isContentType(body.contentType)) {
    return NextResponse.json({ error: 'Invalid contentType' }, { status: 400 })
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
  if (idea.draft_status === 'running') {
    return NextResponse.json({ error: 'Draft in progress' }, { status: 409 })
  }
  // A status change on a drafted idea is nonsensical, but a content-type relabel
  // is exactly the point of reclassifying old drafted posts — so only the status
  // path is blocked once drafted.
  if (hasStatus && idea.status === 'drafted') {
    return NextResponse.json({ error: 'Idea already drafted' }, { status: 409 })
  }

  const patch: { updated_at: string; status?: string; content_type?: string } = {
    updated_at: new Date().toISOString(),
  }
  if (hasStatus) patch.status = body.status
  if (hasContentType) patch.content_type = body.contentType

  const { error } = await supabase.from('resource_ideas').update(patch).eq('id', ideaId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
