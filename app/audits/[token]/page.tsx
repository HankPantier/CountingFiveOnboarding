import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { AuditResult } from '@/types/audit-result'
import { getPreviousRunDeltas, type PreviousRunDeltas } from '@/lib/audit/report-data'
import { AuditReport } from '@/components/admin/audit/AuditReport'

export const runtime = 'nodejs'

// Semi-private share link — keep it out of search indexes.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function PublicAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServerClient()

  // Lookup is by random share token only — never by the internal id.
  const { data: run } = await supabase
    .from('audit_runs')
    .select('*')
    .eq('share_token', token)
    .maybeSingle()

  // Fail closed: missing token, incomplete audit, or no result → 404 (no leak).
  if (!run || run.audit_status !== 'complete' || run.result === null) notFound()

  const previous: PreviousRunDeltas | null = await getPreviousRunDeltas(supabase, run)

  return (
    <main className="min-h-screen bg-surface-page">
      <AuditReport
        result={run.result as unknown as AuditResult}
        createdAt={run.created_at}
        previous={previous}
      />
    </main>
  )
}
