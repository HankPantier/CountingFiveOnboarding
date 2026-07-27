import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/access'
import type { AuditResult } from '@/types/audit-result'
import {
  getDomainScoreHistory,
  getPreviousRunDeltas,
  type PreviousRunDeltas,
  type ScoreHistoryPoint,
} from '@/lib/audit/report-data'
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

  // Auditors may only open audits they own; admins may open any. (The layout
  // already gates on the auditor capability; re-assert it here as defense in
  // depth so the page is safe even if reached without the layout.)
  const user = await getCurrentUser()
  const isAdmin = !!user?.isAdmin
  if (!isAdmin && (!user?.capabilities.includes('auditor') || run.created_by !== user.id)) {
    notFound()
  }

  const isComplete = run.audit_status === 'complete' && run.result !== null

  // Previous completed run for the same domain → score deltas; full history → trend.
  const [previous, scoreHistory]: [PreviousRunDeltas | null, ScoreHistoryPoint[]] = isComplete
    ? await Promise.all([getPreviousRunDeltas(supabase, run), getDomainScoreHistory(supabase, run)])
    : [null, []]

  // Persisted "Edit report with AI" conversation, replayed into the modal.
  const { data: chatRows } = isComplete
    ? await supabase
        .from('audit_messages')
        .select('role, content')
        .eq('audit_run_id', id)
        .order('created_at', { ascending: true })
    : { data: null }
  const chatMessages = chatRows ?? []

  return (
    <>
      <div className="border-b border-border-default bg-surface-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/admin/audits"
              className="shrink-0 font-body text-sm text-text-secondary hover:text-text-primary"
            >
              ← Audits
            </Link>
            <span className="truncate font-heading text-sm font-semibold text-text-primary">
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
            shareToken={run.share_token}
            chatMessages={chatMessages}
            isAdmin={isAdmin}
          />
        </div>
      </div>

      {isComplete ? (
        <AuditReport
          result={run.result as unknown as AuditResult}
          createdAt={run.created_at}
          previous={previous}
          scoreHistory={scoreHistory}
        />
      ) : (
        <AuditProgress
          auditId={id}
          initialStatus={run.audit_status}
          initialStatusDetail={run.status_detail}
          initialErrorMessage={run.error_message}
          initialPagesCrawled={run.pages_crawled}
        />
      )}
    </>
  )
}
