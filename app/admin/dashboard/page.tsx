import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { estimateCostUsd } from '@/lib/content/token-usage'
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

const PAGE_SIZE = 25
const STATUS_FILTERS = ['all', 'pending', 'in_progress', 'completed', 'approved', 'archived'] as const

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>
}) {
  const supabase = createServerClient()
  const sp = await searchParams

  // Managers see only their assigned clients; admins see all (allowed === null).
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  const allowed = await getAccessibleSessionIds(user)

  const q = (sp.q ?? '').trim()
  const statusFilter = STATUS_FILTERS.includes(sp.status as (typeof STATUS_FILTERS)[number])
    ? (sp.status as (typeof STATUS_FILTERS)[number])
    : 'all'
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  // Archived sessions only show up when explicitly filtered for.
  let query = supabase
    .from('sessions')
    .select('id, website_url, status, current_phase, last_activity_at, created_at, reminder_count', { count: 'exact' })
  if (statusFilter === 'all') query = query.neq('status', 'archived')
  else query = query.eq('status', statusFilter)
  if (q) query = query.ilike('website_url', `%${q}%`)
  if (allowed !== null) query = query.in('id', allowed)

  let approvedQuery = supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')
  if (allowed !== null) approvedQuery = approvedQuery.in('id', allowed)

  const [{ data: sessions, count: totalCount }, { count: approvedCount }, { data: usageRows }] = await Promise.all([
    query
      .order('last_activity_at', { ascending: true })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    approvedQuery,
    // AI spend is a global operator metric — admins only.
    user.role === 'admin'
      ? supabase.from('token_usage').select('model, input_tokens, output_tokens, created_at')
      : Promise.resolve({ data: [] as Array<{ model: string; input_tokens: number; output_tokens: number; created_at: string }> }),
  ])

  const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE))
  const filterHref = (over: { q?: string; status?: string; page?: number }) => {
    const params = new URLSearchParams()
    const nq = over.q ?? q
    const ns = over.status ?? statusFilter
    const np = over.page ?? 1
    if (nq) params.set('q', nq)
    if (ns !== 'all') params.set('status', ns)
    if (np > 1) params.set('page', String(np))
    const s = params.toString()
    return `/admin/dashboard${s ? `?${s}` : ''}`
  }

  // Aggregate AI spend so the operator sees burn without opening every job.
  // Server Component: renders once per request on the server, so Date.now() is
  // deterministic for the render — the React-Compiler purity rule doesn't apply.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const spend = (usageRows ?? []).reduce(
    (acc, r) => {
      const cost = estimateCostUsd(r.model, r.input_tokens, r.output_tokens)
      acc.total += cost
      if (new Date(r.created_at).getTime() >= thirtyDaysAgo) acc.recent += cost
      return acc
    },
    { total: 0, recent: 0 }
  )

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

  return (
    <main className="p-8">

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Sessions</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {totalCount ?? 0} {statusFilter === 'all' ? 'active' : statusFilter}
            {q && <span> matching “{q}”</span>}
            {spend.total > 0 && (
              <Link
                href="/admin/token-usage"
                className="ml-3 text-text-muted hover:text-brand-cyan transition-colors"
              >
                · AI spend: ${spend.total.toFixed(2)} total, ${spend.recent.toFixed(2)} last 30 days →
              </Link>
            )}
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
        {user.role === 'admin' && (
          <div className="flex items-center gap-3">
            <Link
              href="/admin/dashboard/new-session"
              className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark"
            >
              New Session
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <form action="/admin/dashboard" className="flex items-center gap-2">
          {statusFilter !== 'all' && <input type="hidden" name="status" value={statusFilter} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by website…"
            aria-label="Search sessions by website"
            className="text-xs font-body px-3 py-1.5 rounded-pill border border-border-default bg-surface-card focus:border-brand-cyan focus:outline-none w-56"
          />
        </form>
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s}
              href={filterHref({ status: s })}
              className={`text-xs font-heading font-semibold px-3 py-1.5 rounded-pill transition-colors ${
                statusFilter === s
                  ? 'bg-brand-navy text-text-inverse'
                  : 'text-text-secondary hover:bg-surface-subtle'
              }`}
            >
              {s === 'all' ? 'Active' : s.replace('_', ' ')}
            </Link>
          ))}
        </div>
      </div>

      {!sessions?.length ? (
        <div className="text-center py-16 text-text-muted font-body">
          {q || statusFilter !== 'all'
            ? 'No sessions match this filter.'
            : 'No sessions yet. Create one to get started.'}
        </div>
      ) : (
        <div className="bg-surface-card border border-border-default rounded-lg shadow-subtle overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10">
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Website</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Phase</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Last Active</th>
                <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Inactive</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session: Session, i) => (
                <tr
                  key={session.id}
                  className={`border-b border-border-default last:border-0 hover:bg-brand-cyan/10 transition-colors ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}
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
                    <span className={`text-sm ${daysInactive(session.last_activity_at) >= 3 ? 'text-warning-strong font-semibold' : 'text-text-muted'}`}>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm font-body">
          {/* Sort is stalest-first (sessions needing attention float up), so
              direction labels would mislead — neutral Prev/Next instead. */}
          {page > 1 ? (
            <Link href={filterHref({ page: page - 1 })} className="text-brand-cyan hover:text-brand-navy font-heading font-semibold">
              ← Prev
            </Link>
          ) : (
            <span className="text-text-muted">← Prev</span>
          )}
          <span className="text-text-secondary">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={filterHref({ page: page + 1 })} className="text-brand-cyan hover:text-brand-navy font-heading font-semibold">
              Next →
            </Link>
          ) : (
            <span className="text-text-muted">Next →</span>
          )}
        </div>
      )}
    </main>
  )
}
