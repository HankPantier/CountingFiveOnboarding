import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import SessionRowActions from '@/components/admin/SessionRowActions'
import type { Database } from '@/types/database'

type Session = Pick<
  Database['public']['Tables']['sessions']['Row'],
  'id' | 'website_url' | 'status' | 'current_phase' | 'last_activity_at' | 'created_at' | 'reminder_count'
>

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
  return `${Math.floor(seconds / 2592000)}mo ago`
}

function daysInactive(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:     'bg-surface-subtle text-text-muted',
    in_progress: 'bg-info/10 text-info',
    completed:   'bg-success/10 text-success',
    approved:    'bg-brand-purple/10 text-brand-purple',
  }
  const labels: Record<string, string> = {
    pending:     'Pending',
    in_progress: 'In Progress',
    completed:   'Completed',
    approved:    'Approved',
  }
  const cls = styles[status] ?? 'bg-surface-subtle text-text-muted'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold ${cls}`}>
      {labels[status] ?? status}
    </span>
  )
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ basecamp?: string }> }) {
  const supabase = createServerClient()
  const sp = await searchParams

  const [{ data: sessions }, { data: bcToken }, { count: approvedCount }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, website_url, status, current_phase, last_activity_at, created_at, reminder_count')
      .order('last_activity_at', { ascending: true })
      .limit(100),
    supabase.from('basecamp_tokens').select('id').eq('id', 1).single(),
    supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved'),
  ])

  // Pull each session's content_job state so the row can show:
  //   - "Start content" if no job exists yet
  //   - "View content"  if a job exists but isn't editable yet
  //   - "Edit content"  if phase >= 6 and a github_repo is provisioned
  const sessionIds = (sessions ?? []).map(s => s.id)
  const { data: contentJobs } = sessionIds.length
    ? await supabase
        .from('content_jobs')
        .select('session_id, phase, github_repo')
        .in('session_id', sessionIds)
    : { data: [] as Array<{ session_id: string; phase: number; github_repo: string | null }> }
  const contentJobBySession = new Map(
    (contentJobs ?? []).map(j => [j.session_id, { phase: j.phase, githubRepo: j.github_repo }])
  )

  const basecampConnected = !!bcToken
  const justConnected = sp.basecamp === 'connected'

  return (
    <main className="p-8">
      {justConnected && (
        <div className="mb-6 bg-success/10 border border-success/30 text-success font-body text-sm rounded-lg px-4 py-3">
          Basecamp connected successfully.
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Sessions</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {sessions?.length ?? 0} total
          </p>
          {(approvedCount ?? 0) > 0 && (
            <Link
              href="/admin/content"
              className="inline-flex items-center gap-2 mt-2 text-sm font-body text-brand-cyan hover:text-brand-navy transition-colors"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-cyan text-text-inverse text-xs font-heading font-bold">
                {approvedCount}
              </span>
              ready for content generation
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!basecampConnected && (
            <a
              href="/api/basecamp/auth"
              className="border border-border-default text-text-secondary font-heading font-semibold text-sm px-5 py-3 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
            >
              Connect Basecamp
            </a>
          )}
          <Link
            href="/admin/dashboard/new-session"
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-cyan-dark"
          >
            New Session
          </Link>
        </div>
      </div>

      {!sessions?.length ? (
        <div className="text-center py-16 text-text-muted font-body">
          No sessions yet. Create one to get started.
        </div>
      ) : (
        <div className="bg-surface-card border border-border-default rounded-lg shadow-subtle overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-default bg-surface-subtle">
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Website</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Phase</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Last Active</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Inactive</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session: Session, i) => (
                <tr
                  key={session.id}
                  className={`border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors ${i % 2 === 1 ? 'bg-surface-subtle/40' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-body text-text-primary truncate max-w-[200px]">
                      {session.website_url}
                    </div>
                    <div className="text-text-muted text-xs mt-0.5 font-mono">
                      {session.id.slice(0, 8)}…
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={session.status} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    Phase {session.current_phase} / 7
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {timeAgo(session.last_activity_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${daysInactive(session.last_activity_at) >= 3 ? 'text-warning font-semibold' : 'text-text-muted'}`}>
                      {daysInactive(session.last_activity_at)}d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SessionRowActions
                      sessionId={session.id}
                      sessionStatus={session.status}
                      hasContentJob={contentJobBySession.has(session.id)}
                      canEditContent={
                        (contentJobBySession.get(session.id)?.phase ?? 0) >= 6 &&
                        !!contentJobBySession.get(session.id)?.githubRepo
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
