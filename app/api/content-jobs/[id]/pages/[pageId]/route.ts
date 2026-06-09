import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'

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
// If any content field is edited, both approvals are atomically reset to false.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id, pageId } = await params
  const body = await req.json()
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
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') {
        return NextResponse.json({ error: `invalid type: ${field}` }, { status: 400 })
      }
      const len = body[field].length
      const cap = FIELD_CAPS[field]
      if (len > cap) {
        return NextResponse.json({ error: `field too long: ${field}` }, { status: 400 })
      }
      updates[field] = body[field]
      contentEdited = true
    }
  }

  // If any content field was edited, reset both approvals atomically
  if (contentEdited) {
    updates.admin_approved_content = false
    updates.client_approved_content = false
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

  return NextResponse.json({ page: data })
}
