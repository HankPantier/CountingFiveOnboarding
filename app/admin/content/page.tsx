import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasOnboardingAccess } from '@/lib/auth/access'
import ContentTable, { type ContentRow } from '@/components/admin/content/ContentTable'

export default async function ContentHubPage() {
  const supabase = createServerClient()

  // Managers see only their assigned clients; admins see all (allowed === null).
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  // Editors reach Content but not the Onboarding surface (Batch, Dashboard).
  const canOnboard = hasOnboardingAccess(user)
  const allowed = await getAccessibleSessionIds(user)

  let sessionsQuery = supabase
    .from('sessions')
    .select('id, website_url, schema_data, approved_at, content_generation_phase')
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(100)
  if (allowed !== null) sessionsQuery = sessionsQuery.in('id', allowed)

  const { data: sessions } = await sessionsQuery

  // Get content job phases for sessions that have them
  const sessionIds = sessions?.map(s => s.id) ?? []
  const { data: contentJobs } = sessionIds.length > 0
    ? await supabase
        .from('content_jobs')
        .select('session_id, phase, status, github_repo')
        .in('session_id', sessionIds)
    : { data: [] }

  const jobBySession = new Map(
    (contentJobs ?? []).map(j => [j.session_id, j])
  )

  const rows: ContentRow[] = (sessions ?? []).map((session) => {
    const job = jobBySession.get(session.id)
    const firmName = (session.schema_data as Record<string, unknown>)?.business
      ? ((session.schema_data as Record<string, Record<string, unknown>>).business?.name as string)
      : null
    return {
      id: session.id,
      websiteUrl: session.website_url,
      firmName: firmName ?? null,
      approvedAt: session.approved_at,
      phase: job?.phase ?? null,
      canEditContent: (job?.phase ?? 0) >= 6 && !!job?.github_repo,
    }
  })

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Content Generation</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {sessions?.length ?? 0} approved session{sessions?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canOnboard && (
            <Link
              href="/admin/blog-batch"
              className="rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 shadow-cyan-base transition-all hover:bg-brand-cyan-dark hover:-translate-y-px hover:shadow-cyan-glow"
            >
              Batch Content
            </Link>
          )}
          <Link
            href={canOnboard ? '/admin/dashboard' : '/admin/home'}
            className="rounded-pill border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 transition-all hover:bg-surface-subtle"
          >
            {canOnboard ? 'Back to Dashboard' : 'Back to Home'}
          </Link>
        </div>
      </div>

      {!sessions?.length ? (
        <div className="text-center py-16 text-text-muted font-body">
          No approved sessions yet. Approve a completed session to begin content generation.
        </div>
      ) : (
        <ContentTable rows={rows} />
      )}
    </main>
  )
}
