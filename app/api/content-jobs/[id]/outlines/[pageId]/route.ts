import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import type { Json } from '@/types/database'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { pageId } = await params
  const body = await req.json()
  const supabase = createServerClient()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.h1 !== undefined) updates.h1 = body.h1
  if (body.sections !== undefined) updates.sections = body.sections as Json
  if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes
  if (body.admin_approved !== undefined) updates.admin_approved = body.admin_approved

  const { data, error } = await supabase
    .from('page_outlines')
    .update(updates)
    .eq('id', pageId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ outline: data })
}
