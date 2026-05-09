import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const auth = await requireAdmin()
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

// Per-page admin updates. Currently only admin_approved_content; intentionally
// strict so the package gate cannot be bypassed by a typo elsewhere.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id, pageId } = await params
  const body = await req.json()
  const supabase = createServerClient()

  const updates: Record<string, unknown> = {}

  if (body.admin_approved_content !== undefined) {
    if (typeof body.admin_approved_content !== 'boolean') {
      return NextResponse.json({ error: 'admin_approved_content must be boolean' }, { status: 400 })
    }
    updates.admin_approved_content = body.admin_approved_content
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
