import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/types/database'
import type { SessionSchema } from '@/types/session-schema'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Public GET endpoint for client review. No admin auth required.
// Only returns pages that are flagged for client review.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params
  const supabase = createServerClient()

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  if (!UUID_RE.test(pageId)) {
    return NextResponse.json({ error: 'Invalid pageId' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('generated_pages')
    .select('*')
    .eq('id', pageId)
    .eq('content_job_id', id)
    .eq('needs_client_review', true)
    .single()

  if (error || !data) {
    if (error) console.error('[review-get] supabase error:', error)
    return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  }

  return NextResponse.json({ page: data })
}

// Public PATCH endpoint for client review. No admin auth required.
// Allows clients to edit and approve pages flagged for review.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params
  const supabase = createServerClient()

  // Validate both route params are valid UUIDs
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  if (!UUID_RE.test(pageId)) {
    return NextResponse.json({ error: 'Invalid pageId' }, { status: 400 })
  }

  const body = await req.json()

  // Define field caps
  const CONTENT_FIELDS = ['content_markdown', 'meta_title', 'meta_description', 'target_keyword']
  const FIELD_CAPS: Record<string, number> = {
    content_markdown: 50000,
    meta_title: 120,
    meta_description: 320,
    target_keyword: 100,
  }

  // Admin-only fields that clients cannot set
  const ADMIN_ONLY_FIELDS = ['admin_approved_content', 'needs_client_review']

  // Reject admin-only fields explicitly
  for (const field of ADMIN_ONLY_FIELDS) {
    if (body[field] !== undefined) {
      return NextResponse.json({ error: `field not allowed: ${field}` }, { status: 400 })
    }
  }

  const updates: Record<string, unknown> = {}
  let contentEdited = false

  // Process client_approved_content flag
  if (body.client_approved_content !== undefined) {
    if (typeof body.client_approved_content !== 'boolean') {
      return NextResponse.json({ error: 'invalid type: client_approved_content' }, { status: 400 })
    }
    updates.client_approved_content = body.client_approved_content
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

  // Update with content_job_id and needs_client_review gates for defence in depth
  // Only allow updates to pages that exist, belong to this content job, and are flagged for review
  const { data, error } = await supabase
    .from('generated_pages')
    .update(updates)
    .eq('id', pageId)
    .eq('content_job_id', id)
    .eq('needs_client_review', true)
    .select('*')
    .single()

  if (error || !data) {
    if (error) console.error('[review-patch] supabase error:', error)
    return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  }

  // When this approval clears the last outstanding review page, tell the
  // admin — otherwise approvals sit undiscovered until someone checks the
  // dashboard. Fail-soft: email problems never block the client's PATCH.
  if (updates.client_approved_content === true) {
    try {
      await notifyIfReviewComplete(supabase, id)
    } catch (err) {
      console.error('[review-patch] completion notification failed:', err)
    }
  }

  return NextResponse.json({ page: data })
}

async function notifyIfReviewComplete(
  supabase: ReturnType<typeof createServerClient>,
  contentJobId: string
) {
  const { count: remaining } = await supabase
    .from('generated_pages')
    .select('id', { count: 'exact', head: true })
    .eq('content_job_id', contentJobId)
    .eq('needs_client_review', true)
    .eq('client_approved_content', false)
  if ((remaining ?? 1) > 0) return

  const { count: approved } = await supabase
    .from('generated_pages')
    .select('id', { count: 'exact', head: true })
    .eq('content_job_id', contentJobId)
    .eq('needs_client_review', true)
    .eq('client_approved_content', true)

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', contentJobId)
    .single()
  if (!job) return
  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', job.session_id)
    .single()
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const firmName = schema.business?.name ?? session?.website_url ?? 'Client'

  const adminEmail = process.env.ADMIN_EMAIL
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!adminEmail || !fromEmail || !process.env.RESEND_API_KEY) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: fromEmail,
    to: adminEmail,
    subject: `[CountingFive] Client review complete — ${firmName}`,
    html: `
      <h2>Client Review Complete</h2>
      <p><strong>${firmName}</strong></p>
      <p>The client has approved all ${approved ?? 0} page(s) flagged for review.</p>
      <p><a href="${appUrl}/admin/content/${job.session_id}">Continue to packaging →</a></p>
    `,
  })
}
