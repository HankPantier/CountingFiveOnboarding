import { after, NextResponse } from 'next/server'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { reviewContentForMbpImpact } from '@/lib/mbp/impact-review'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth
  const { id, pageId } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('generated_pages')
    .select('*')
    .eq('id', pageId)
    .eq('content_job_id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  return NextResponse.json({ page: data })
}

// Per-page admin updates. Accepts approval flags and content fields.
// If any content field is edited, ADMIN approval is reset to false; client
// approval is preserved (the operator re-flags client review deliberately).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth
  const sessionId = auth.sessionId

  const { id, pageId } = await params
  const body = await readJsonBody<Record<string, unknown>>(req)
  if (body instanceof NextResponse) return body
  const supabase = createServerClient()

  const CONTENT_FIELDS = ['content_markdown', 'meta_title', 'meta_description', 'target_keyword']
  const FIELD_CAPS: Record<string, number> = {
    content_markdown: 50000,
    meta_title: 120,
    meta_description: 320,
    target_keyword: 100,
  }

  const updates: Record<string, unknown> = {}
  let contentEdited = false

  // Process approval flags
  if (body.admin_approved_content !== undefined) {
    if (typeof body.admin_approved_content !== 'boolean') {
      return NextResponse.json({ error: 'invalid type: admin_approved_content' }, { status: 400 })
    }
    updates.admin_approved_content = body.admin_approved_content
  }

  if (body.client_approved_content !== undefined) {
    if (typeof body.client_approved_content !== 'boolean') {
      return NextResponse.json({ error: 'invalid type: client_approved_content' }, { status: 400 })
    }
    updates.client_approved_content = body.client_approved_content
  }

  if (body.needs_client_review !== undefined) {
    if (typeof body.needs_client_review !== 'boolean') {
      return NextResponse.json({ error: 'invalid type: needs_client_review' }, { status: 400 })
    }
    updates.needs_client_review = body.needs_client_review
  }

  // Process content fields
  for (const field of CONTENT_FIELDS) {
    const value = body[field]
    if (value !== undefined) {
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `invalid type: ${field}` }, { status: 400 })
      }
      const cap = FIELD_CAPS[field]
      if (value.length > cap) {
        return NextResponse.json({ error: `field too long: ${field}` }, { status: 400 })
      }
      updates[field] = value
      contentEdited = true
    }
  }

  // If any content field was edited, the operator must re-sign off (reset admin
  // approval). Client approval is deliberately PRESERVED — the operator re-flags
  // for client review on purpose, so an edit shouldn't silently blow away a
  // client's prior sign-off and force a fresh review round.
  if (contentEdited) {
    updates.admin_approved_content = false
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no supported fields in body' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('generated_pages')
    .update(updates)
    .eq('id', pageId)
    .eq('content_job_id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  if (contentEdited && typeof data.content_markdown === 'string') {
    after(() =>
      reviewContentForMbpImpact({
        sessionId,
        origin: 'page_edit',
        sourceRef: data.page_url ?? pageId,
        changedText: data.content_markdown ?? '',
      }).catch(err => console.error('[mbp-impact] page_edit review failed:', err))
    )
  }

  return NextResponse.json({ page: data })
}
