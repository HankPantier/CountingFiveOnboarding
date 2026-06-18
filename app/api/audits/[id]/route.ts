import { NextResponse } from 'next/server'
import { requireAuditAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// GET /api/audits/[id] — full audit run (including the result JSON).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuditAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase.from('audit_runs').select('*').eq('id', id).single()

  if (error || !data) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }
  return NextResponse.json({ audit: data })
}

// DELETE /api/audits/[id] — remove a run (admins; auditors for their own).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuditAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase.from('audit_runs').delete().eq('id', id).select('id')

  if (error) {
    console.error('[audits] delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete audit' }, { status: 500 })
  }
  if (!data?.length) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
