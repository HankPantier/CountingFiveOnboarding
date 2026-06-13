import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { StartSessionForm } from '@/components/admin/audit/StartSessionForm'

export const runtime = 'nodejs'

export default async function StartSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerClient()

  const { data: run } = await supabase
    .from('audit_runs')
    .select('id, site_name, domain, audit_status, approved_at, session_id')
    .eq('id', id)
    .single()

  if (!run) notFound()
  // Already started → go to the session.
  if (run.session_id) redirect(`/admin/sessions/${run.session_id}`)
  // Must be a completed, approved audit.
  if (run.audit_status !== 'complete' || !run.approved_at) redirect(`/admin/audits/${id}`)

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href={`/admin/audits/${id}`} className="font-body text-sm text-text-secondary hover:text-text-primary">
        ← Back to audit
      </Link>
      <h1 className="mt-4 font-heading text-2xl font-bold text-brand-navy">Start a Session</h1>
      <p className="mt-1 font-body text-sm text-text-secondary">
        Review the AI-drafted profile for <span className="font-semibold">{run.site_name || run.domain}</span>, then create
        the onboarding session.
      </p>
      <div className="mt-8">
        <StartSessionForm auditId={id} />
      </div>
    </main>
  )
}
