import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { draftSessionFromAudit } from '@/lib/session-draft/draft-from-audit'
import type { AuditResult } from '@/types/audit-result'

export const runtime = 'nodejs'
export const maxDuration = 120

// POST /api/audits/[id]/draft-session — AI-draft a session profile from the
// audit's crawled content. Returns the draft for admin review; does NOT create
// the session (that's POST .../start-session after the admin confirms).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: run } = await supabase.from('audit_runs').select('*').eq('id', id).single()
  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (!run.approved_at) {
    return NextResponse.json({ error: 'Audit must be approved first' }, { status: 409 })
  }
  if (run.audit_status !== 'complete' || !run.result) {
    return NextResponse.json({ error: 'Audit is not complete' }, { status: 409 })
  }

  const result = run.result as unknown as AuditResult
  if (!result.url || !result.page_analysis_summary?.length) {
    return NextResponse.json({ error: 'Audit has no page content to draft from' }, { status: 422 })
  }

  const { schema, gaps, contact, coverage } = await draftSessionFromAudit(result, id)

  return NextResponse.json({ schemaData: schema, gapList: gaps, contact, coverage })
}
