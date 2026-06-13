import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { AuditResult, CategoryScoreMap } from '@/types/audit-result'
import { AuditActions } from '@/components/admin/audit/AuditActions'
import { AuditReport } from '@/components/admin/audit/AuditReport'
import { AuditProgress } from '@/components/admin/audit/AuditProgress'
import { AuditStatusBadge } from '@/components/admin/audit/AuditBadges'

export const runtime = 'nodejs'

export default async function AuditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerClient()

  const { data: run } = await supabase.from('audit_runs').select('*').eq('id', id).single()
  if (!run) notFound()

  const isComplete = run.audit_status === 'complete' && run.result !== null

  // Previous completed run for the same domain → score deltas.
  let previous: { overall_score: number | null; category_scores: CategoryScoreMap | null } | null =
    null
  if (isComplete) {
    const { data: prev } = await supabase
      .from('audit_runs')
      .select('overall_score, category_scores')
      .eq('domain', run.domain)
      .eq('audit_status', 'complete')
      .lt('created_at', run.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (prev) {
      previous = {
        overall_score: prev.overall_score,
        category_scores: (prev.category_scores as CategoryScoreMap | null) ?? null,
      }
    }
  }

  return (
    <>
      <div className="border-b border-border-default bg-surface-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/audits"
              className="font-body text-sm text-text-secondary hover:text-text-primary"
            >
              ← Audits
            </Link>
            <span className="font-heading text-sm font-semibold text-text-primary">
              {run.site_name || run.domain}
            </span>
            <AuditStatusBadge status={run.audit_status} />
            {run.session_id && (
              <span className="font-body text-xs text-text-muted">· session started</span>
            )}
          </div>
          <AuditActions
            auditId={id}
            status={run.audit_status}
            approved={!!run.approved_at}
            sessionId={run.session_id}
          />
        </div>
      </div>

      {isComplete ? (
        <AuditReport
          result={run.result as unknown as AuditResult}
          createdAt={run.created_at}
          previous={previous}
        />
      ) : (
        <AuditProgress auditId={id} initialStatus={run.audit_status} />
      )}
    </>
  )
}
