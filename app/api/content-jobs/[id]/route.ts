import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runContentGeneration } from '@/lib/content/content-generator'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()

  const supabase = createServerClient()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.palette !== undefined) updates.palette = body.palette
  if (body.confirmed_sitemap !== undefined) updates.confirmed_sitemap = body.confirmed_sitemap
  if (body.phase !== undefined) updates.phase = body.phase
  if (body.status !== undefined) {
    const validStatuses = ['active', 'complete', 'error']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }
  if (body.error_message !== undefined) updates.error_message = body.error_message

  const { data, error } = await supabase
    .from('content_jobs')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-trigger content generation when advancing to phase 5
  if (body.phase === 5 && data.session_id) {
    runContentGeneration(id, data.session_id).catch(err =>
      console.error('[content-gen] Auto-trigger failed:', err)
    )
  }

  return NextResponse.json({ contentJob: data })
}
