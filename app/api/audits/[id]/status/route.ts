import { NextResponse } from 'next/server'
import { requireAuditAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// GET /api/audits/[id]/status — lightweight poll target for the UI.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuditAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('audit_runs')
    .select('audit_status, status_detail, pages_crawled, overall_score, overall_grade, error_message')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}
