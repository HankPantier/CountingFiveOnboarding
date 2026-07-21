import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'

const CONTENT_PHASE_LABELS: Record<number, string> = {
  1: 'Palette',
  2: 'Sitemap',
  3: 'Research',
  4: 'Outlines',
  5: 'Generating',
  6: 'Complete',
}

function ContentPhaseBadge({ phase }: { phase: number | null }) {
  if (phase === null) {
    return (
      <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-surface-subtle text-text-muted">
        Not Started
      </span>
    )
  }
  if (phase === 6) {
    return (
      <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-success/10 text-success">
        Complete
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-brand-cyan/10 text-brand-cyan-dark">
      {CONTENT_PHASE_LABELS[phase] ?? `Phase ${phase}`}
    </span>
  )
}

export default async function ContentHubPage() {
  const supabase = createServerClient()

  // Managers see only their assigned clients; admins see all (allowed === null).
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
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
          <Link
            href="/admin/blog-batch"
            className="rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 shadow-cyan-base transition-all hover:bg-brand-cyan-dark hover:-translate-y-px hover:shadow-cyan-glow"
          >
            Batch Content
          </Link>
          <Link
            href="/admin/dashboard"
            className="rounded-pill border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 transition-all hover:bg-surface-subtle"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      {!sessions?.length ? (
        <div className="text-center py-16 text-text-muted font-body">
          No approved sessions yet. Approve a completed session to begin content generation.
        </div>
      ) : (
        <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-default bg-[#FBFCFD]">
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Firm / Website</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Approved</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Content Phase</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const job = jobBySession.get(session.id)
                const phase = job?.phase ?? null
                const canEditContent = (job?.phase ?? 0) >= 6 && !!job?.github_repo
                const firmName = (session.schema_data as Record<string, unknown>)?.business
                  ? ((session.schema_data as Record<string, Record<string, unknown>>).business?.name as string)
                  : null

                return (
                  <tr
                    key={session.id}
                    className="border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-body text-text-primary font-semibold">
                        {firmName ?? session.website_url}
                      </div>
                      {firmName && (
                        <div className="text-text-muted text-xs mt-0.5">{session.website_url}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {session.approved_at
                        ? new Date(session.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ContentPhaseBadge phase={phase} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {phase === 6 && (
                          canEditContent ? (
                            <Link
                              href={`/admin/content/${session.id}/edit`}
                              className="text-brand-navy hover:text-brand-cyan font-heading font-semibold text-xs transition-colors"
                              title="Edit published content in the linked GitHub repo"
                            >
                              Edit content ↗
                            </Link>
                          ) : (
                            <Link
                              href={`/admin/content/${session.id}`}
                              className="text-text-muted hover:text-brand-cyan font-heading font-semibold text-xs transition-colors"
                              title="Open the content workflow to connect a GitHub repo"
                            >
                              Connect repo →
                            </Link>
                          )
                        )}
                        <Link
                          href={`/admin/content/${session.id}`}
                          className={`inline-flex items-center font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all ${
                            phase === 6
                              ? 'border border-success/50 text-success hover:bg-success/10'
                              : phase !== null
                                ? 'bg-brand-cyan text-text-inverse hover:bg-brand-cyan-dark'
                                : 'bg-brand-cyan text-text-inverse hover:bg-brand-cyan-dark'
                          }`}
                        >
                          {phase === 6 ? 'Download' : phase !== null ? 'Continue' : 'Start'}
                          {phase !== null && phase !== 6 && <span className="ml-1">&rarr;</span>}
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
