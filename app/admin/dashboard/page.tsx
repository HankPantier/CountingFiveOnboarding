import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { estimateCostUsd } from '@/lib/content/token-usage'
import SessionRowActions from '@/components/admin/SessionRowActions'
import DashboardSearch from '@/components/admin/DashboardSearch'
import PipelineChart from '@/components/admin/PipelineChart'
import StatCard from '@/components/admin/ui/StatCard'
import StatusPill from '@/components/admin/StatusPill'
import HealthRing from '@/components/admin/ui/HealthRing'
import PhaseStepper from '@/components/admin/ui/PhaseStepper'
import { sessionsOverview } from '@/lib/audit/report-aggregates'
import type { Database } from '@/types/database'

type Session = Pick<
  Database['public']['Tables']['sessions']['Row'],
  'id' | 'website_url' | 'status' | 'current_phase' | 'last_activity_at' | 'created_at' | 'reminder_count'
>

const STAGE = ['Not started', 'Contact', 'Processing', 'Review', 'Questions', 'Files', 'Generation', 'Approved']
const AVATAR = [
  'bg-brand-cyan/10 text-brand-cyan-dark',
  'bg-brand-navy/10 text-brand-navy',
  'bg-brand-purple/10 text-brand-purple',
]

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

function siteInitials(url: string): string {
  const host = url.replace(/^https?:\/\//, '').replace(/^www\./, '')
  const core = host.split('.')[0] ?? host
  return core.slice(0, 2).toUpperCase()
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
  if (q) {
    // In a PostgREST or() string, ilike uses * wildcards; strip chars that would
    // break the comma/paren-delimited filter grammar.
    const esc = q.replace(/[%,()]/g, ' ')
    query = query.or(`website_url.ilike.*${esc}*,schema_data->business->>name.ilike.*${esc}*`)
  }
  if (allowed !== null) query = query.in('id', allowed)

  let approvedQuery = supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')
  if (allowed !== null) approvedQuery = approvedQuery.in('id', allowed)

  // Pipeline overview spans the whole active book (not the current filter/page),
  // so it gets its own lightweight status+phase query.
  let pipelineQuery = supabase.from('sessions').select('status, current_phase').neq('status', 'archived')
  if (allowed !== null) pipelineQuery = pipelineQuery.in('id', allowed)

  // AI spend is a global operator metric — admins only. Aggregated in the DB
  // (token_usage_model_totals, migration 044): the old fetch-every-row-and-sum
  // approach grew without bound.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const emptyTotals = Promise.resolve({
    data: [] as Array<{ model: string; input_tokens: number; output_tokens: number }>,
  })
  const [
    { data: sessions, count: totalCount },
    { count: approvedCount },
    { data: totalUsage },
    { data: recentUsage },
    { data: pipelineRows },
  ] = await Promise.all([
    query
      .order('last_activity_at', { ascending: true })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    approvedQuery,
    user.isAdmin ? supabase.rpc('token_usage_model_totals') : emptyTotals,
    user.isAdmin ? supabase.rpc('token_usage_model_totals', { since: thirtyDaysAgoIso }) : emptyTotals,
    pipelineQuery,
  ])

  const pipeline = sessionsOverview(
    (pipelineRows ?? []).map((r) => ({ status: r.status, current_phase: r.current_phase })),
  )

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

  // Cost math stays in app code (PRICING map) over the per-model DB aggregates.
  const sumCost = (rows: Array<{ model: string; input_tokens: number; output_tokens: number }> | null) =>
    (rows ?? []).reduce((acc, r) => acc + estimateCostUsd(r.model, r.input_tokens, r.output_tokens), 0)
  const spend = { total: sumCost(totalUsage), recent: sumCost(recentUsage) }

  // ── KPI row (derived from data already fetched — no new queries) ──────────
  const byStatus = Object.fromEntries(pipeline.statuses.map((s) => [s.status, s.count]))
  const inOnboarding = (byStatus['pending'] ?? 0) + (byStatus['in_progress'] ?? 0)

  return (
    <main className="mx-auto max-w-[1260px] p-8 pb-14">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-heading text-[27px] font-bold leading-tight text-brand-navy">Onboarding</h1>
          <p className="mt-1.5 font-body text-sm text-text-secondary">
            {totalCount ?? 0} {statusFilter === 'all' ? 'active' : statusFilter} clients moving through the 7-phase intake
            {q && <span> · matching “{q}”</span>}
          </p>
        </div>
        {user.role === 'admin' && (
          <Link
            href="/admin/dashboard/new-session"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-cyan px-4 py-2.5 font-heading text-[13px] font-semibold text-text-inverse shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New session
          </Link>
        )}
      </div>

      {/* KPI cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active sessions" value={pipeline.total} context={`${inOnboarding} still in onboarding`} />
        <StatCard label="In onboarding" value={inOnboarding} context="no live site yet" />
        <StatCard
          label="Ready for content"
          value={approvedCount ?? 0}
          context={(approvedCount ?? 0) > 0 ? 'awaiting generation' : 'all clear'}
          tone={(approvedCount ?? 0) > 0 ? 'good' : 'muted'}
          href="/admin/content"
        />
        {user.isAdmin && (
          <StatCard label="AI spend · 30d" value={`$${spend.recent.toFixed(2)}`} context="last 30 days" href="/admin/token-usage" />
        )}
      </div>

      {/* Pipeline */}
      <div className="mb-6">
        <PipelineChart overview={pipeline} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-pill border border-border-default bg-surface-card p-1">
          {STATUS_FILTERS.filter((s) => s !== 'archived').map((s) => (
            <Link
              key={s}
              href={filterHref({ status: s })}
              className={`rounded-pill px-3.5 py-1.5 font-heading text-[12.5px] font-semibold transition-colors ${
                statusFilter === s ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle'
              }`}
            >
              {s === 'all' ? 'Active' : s.replace('_', ' ')}
            </Link>
          ))}
        </div>
        <DashboardSearch initialQuery={q} status={statusFilter} />
        <div className="flex-1" />
      </div>

      {/* Table */}
      {!sessions?.length ? (
        <div className="py-16 text-center font-body text-text-muted">
          {q || statusFilter !== 'all' ? 'No sessions match this filter.' : 'No sessions yet. Create one to get started.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface-card shadow-subtle">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default bg-[#FBFCFD]">
                {['Client', 'Status', 'Phase', 'Health', 'Last active', 'Inactive', ''].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left font-heading text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session: Session, i) => (
                <tr key={session.id} className="border-b border-border-default transition-colors last:border-0 hover:bg-surface-subtle">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-heading text-[13px] font-semibold ${AVATAR[i % 3]}`}>
                        {siteInitials(session.website_url)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/admin/sessions/${session.id}`}
                          className="block max-w-[220px] truncate font-heading text-sm font-semibold text-brand-navy hover:text-brand-cyan"
                        >
                          {session.website_url}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-text-muted">{session.id.slice(0, 8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={session.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="mb-1.5 whitespace-nowrap font-body text-xs text-text-secondary">
                      Phase {session.current_phase} · {STAGE[session.current_phase] ?? '—'}
                    </div>
                    <PhaseStepper phase={session.current_phase} />
                  </td>
                  <td className="px-4 py-3">
                    <HealthRing
                      from={{
                        current_phase: session.current_phase,
                        last_activity_at: session.last_activity_at,
                        reminder_count: session.reminder_count,
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-body text-sm text-text-secondary">
                    {timeAgo(session.last_activity_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-body text-sm font-semibold ${
                        daysInactive(session.last_activity_at) >= 3 ? 'text-warning-strong' : 'text-text-muted'
                      }`}
                    >
                      {daysInactive(session.last_activity_at)}d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SessionRowActions
                      sessionId={session.id}
                      sessionStatus={session.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 font-body text-sm">
          {page > 1 ? (
            <Link href={filterHref({ page: page - 1 })} className="font-heading font-semibold text-brand-cyan hover:text-brand-navy">
              ← Prev
            </Link>
          ) : (
            <span className="text-text-muted">← Prev</span>
          )}
          <span className="text-text-secondary">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={filterHref({ page: page + 1 })} className="font-heading font-semibold text-brand-cyan hover:text-brand-navy">
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
