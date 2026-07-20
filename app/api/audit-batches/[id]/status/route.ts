import { NextResponse } from 'next/server'
import { requireAuditBatchAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RunHealth = 'done' | 'warning' | 'error' | 'running' | 'queued'
// Machine-readable classification so the UI can attach targeted troubleshooting
// without re-matching raw error strings.
export type IssueKind =
  | 'crawl_failed'
  | 'timeout'
  | 'thin_crawl'
  | 'niche_incomplete'
  | 'worker_error'
  | 'unknown'
  | null

export interface AuditBatchRunView {
  id: string
  url: string
  domain: string
  auditStatus: string
  statusDetail: string | null
  overallGrade: string | null
  overallScore: number | null
  pagesCrawled: number | null
  errorMessage: string | null
  health: RunHealth
  issueKind: IssueKind
  issue: string | null
}

export interface AuditBatchStatusResponse {
  id: string
  label: string | null
  status: string
  runs: AuditBatchRunView[]
  counts: { total: number; done: number; warning: number; error: number; running: number; queued: number }
}

interface RunRow {
  id: string
  url: string
  domain: string
  audit_status: string
  status_detail: string | null
  overall_grade: string | null
  overall_score: number | null
  pages_crawled: number | null
  error_message: string | null
}

// Single source of truth for a run's batch-level health + issue classification.
function classifyRun(r: RunRow): Pick<AuditBatchRunView, 'health' | 'issueKind' | 'issue'> {
  if (r.audit_status === 'error') {
    const msg = r.error_message ?? ''
    let issueKind: IssueKind = 'unknown'
    if (/could not crawl any pages/i.test(msg)) issueKind = 'crawl_failed'
    else if (/timed out/i.test(msg)) issueKind = 'timeout'
    else if (/batch worker error/i.test(msg)) issueKind = 'worker_error'
    return { health: 'error', issueKind, issue: r.error_message ?? 'Audit failed' }
  }
  if (r.audit_status === 'complete') {
    if (r.status_detail && /niche content incomplete/i.test(r.status_detail)) {
      return {
        health: 'warning',
        issueKind: 'niche_incomplete',
        issue: 'Services & niche content came back incomplete — the rest of the report is fine.',
      }
    }
    if (r.pages_crawled !== null && r.pages_crawled <= 1) {
      return {
        health: 'warning',
        issueKind: 'thin_crawl',
        issue: `Only ${r.pages_crawled} page crawled — internal links may be JavaScript-rendered or blocked.`,
      }
    }
    return { health: 'done', issueKind: null, issue: null }
  }
  if (r.audit_status === 'queued') return { health: 'queued', issueKind: null, issue: null }
  return { health: 'running', issueKind: null, issue: null }
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
    .select('id, url, domain, audit_status, status_detail, overall_grade, overall_score, pages_crawled, error_message')
    .eq('audit_batch_id', id)
    .order('created_at', { ascending: true })

  const runViews: AuditBatchRunView[] = ((runs ?? []) as RunRow[]).map((r) => ({
    id: r.id,
    url: r.url,
    domain: r.domain,
    auditStatus: r.audit_status,
    statusDetail: r.status_detail,
    overallGrade: r.overall_grade,
    overallScore: r.overall_score,
    pagesCrawled: r.pages_crawled,
    errorMessage: r.error_message,
    ...classifyRun(r),
  }))

  const counts = {
    total: runViews.length,
    done: runViews.filter((r) => r.health === 'done').length,
    warning: runViews.filter((r) => r.health === 'warning').length,
    error: runViews.filter((r) => r.health === 'error').length,
    running: runViews.filter((r) => r.health === 'running').length,
    queued: runViews.filter((r) => r.health === 'queued').length,
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
