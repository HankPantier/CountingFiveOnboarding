import { NextResponse } from 'next/server'
import { requireAuditBatchAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RUNNING_STATES = ['crawling', 'analyzing', 'researching', 'scoring', 'rendering']

export interface AuditBatchRunView {
  id: string
  url: string
  domain: string
  auditStatus: string
  statusDetail: string | null
  overallGrade: string | null
  overallScore: number | null
}

export interface AuditBatchStatusResponse {
  id: string
  label: string | null
  status: string
  runs: AuditBatchRunView[]
  counts: { total: number; queued: number; running: number; complete: number; error: number }
}

// GET /api/audit-batches/[id]/status — progress feed for the batch detail UI.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  const auth = await requireAuditBatchAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const { data: batch } = await supabase
    .from('audit_batches')
    .select('id, label, status')
    .eq('id', id)
    .single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const { data: runs } = await supabase
    .from('audit_runs')
    .select('id, url, domain, audit_status, status_detail, overall_grade, overall_score')
    .eq('audit_batch_id', id)
    .order('created_at', { ascending: true })

  const runViews: AuditBatchRunView[] = (runs ?? []).map((r) => ({
    id: r.id,
    url: r.url,
    domain: r.domain,
    auditStatus: r.audit_status,
    statusDetail: r.status_detail,
    overallGrade: r.overall_grade,
    overallScore: r.overall_score,
  }))

  const counts = {
    total: runViews.length,
    queued: runViews.filter((r) => r.auditStatus === 'queued').length,
    running: runViews.filter((r) => RUNNING_STATES.includes(r.auditStatus)).length,
    complete: runViews.filter((r) => r.auditStatus === 'complete').length,
    error: runViews.filter((r) => r.auditStatus === 'error').length,
  }

  const response: AuditBatchStatusResponse = {
    id: batch.id,
    label: batch.label,
    status: batch.status,
    runs: runViews,
    counts,
  }
  return NextResponse.json(response)
}
