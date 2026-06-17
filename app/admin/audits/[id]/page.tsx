import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { AuditResult } from '@/types/audit-result'
import { getPreviousRunDeltas, type PreviousRunDeltas } from '@/lib/audit/report-data'
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
  const previous: PreviousRunDeltas | null = isComplete
    ? await getPreviousRunDeltas(supabase, run)
    : null

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
            shareToken={run.share_token}
            chatMessages={chatMessages}
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
