import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleAuditScope, hasCapability } from '@/lib/auth/access'
import AuditsTable, { type AuditRow } from '@/components/admin/audit/AuditsTable'
import AuditsOverviewCharts from '@/components/admin/audit/AuditsOverviewCharts'
import StatCard from '@/components/admin/ui/StatCard'
import { auditsOverview } from '@/lib/audit/report-aggregates'

export const runtime = 'nodejs'

/** Map each completed run to its score delta vs the previous completed run for
 * the same domain. */
function computeDeltas(rows: AuditRow[]): Record<string, number | null> {
  const byDomain = new Map<string, AuditRow[]>()
  for (const r of rows) {
    if (r.audit_status !== 'complete' || r.overall_score === null) continue
    const list = byDomain.get(r.domain) ?? []
    list.push(r)
    byDomain.set(r.domain, list)
  }
  const deltas: Record<string, number | null> = {}
  for (const list of byDomain.values()) {
    // oldest → newest
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
    sorted.forEach((run, i) => {
      deltas[run.id] = i === 0 ? null : run.overall_score! - sorted[i - 1].overall_score!
    })
  }
  return deltas
}

const FOLDERS = ['prospect', 'working', 'client'] as const
type Folder = (typeof FOLDERS)[number]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Build an audits-list URL, preserving the folder + runBy dimensions.
function auditsHref(folder: string, runBy: string | null): string {
  const p = new URLSearchParams()
  if (folder && folder !== 'all') p.set('folder', folder)
  if (runBy) p.set('runBy', runBy)
  const qs = p.toString()
  return qs ? `/admin/audits?${qs}` : '/admin/audits'
}

export default async function AuditsListPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; runBy?: string }>
}) {
  const supabase = createServerClient()
  const user = await getCurrentUser()
  const scope = user ? getAccessibleAuditScope(user) : { createdBy: '' }

  const sp = await searchParams
  const folderParam = sp.folder
  const folder: Folder | 'all' =
    folderParam && (FOLDERS as readonly string[]).includes(folderParam) ? (folderParam as Folder) : 'all'
  // Filter to a single runner (created_by). Admins only in practice — the column
  // is admin-only and auditor scope already pins created_by to self.
  const runByFilter = sp.runBy && UUID_RE.test(sp.runBy) ? sp.runBy : null

  // Per-folder counts across ALL (scoped) audits, not just the loaded page.
  const countFor = async (g: Folder): Promise<number> => {
    let q = supabase.from('audit_runs').select('id', { count: 'exact', head: true }).eq('audit_group', g)
    if (scope) q = q.eq('created_by', scope.createdBy)
    if (runByFilter) q = q.eq('created_by', runByFilter)
    const { count } = await q
    return count ?? 0
  }
  const [prospectCount, workingCount, clientCount] = await Promise.all(FOLDERS.map(countFor))
  const folderCounts: Record<Folder | 'all', number> = {
    prospect: prospectCount,
    working: workingCount,
    client: clientCount,
    all: prospectCount + workingCount + clientCount,
  }

  let query = supabase
    .from('audit_runs')
    .select(
      'id, url, domain, site_name, audit_status, overall_score, overall_grade, pages_crawled, created_at, audit_batch_id, audit_group, created_by',
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (scope) query = query.eq('created_by', scope.createdBy)
  if (folder !== 'all') query = query.eq('audit_group', folder)
  if (runByFilter) query = query.eq('created_by', runByFilter)
  const { data } = await query

  // Resolve batch labels for any runs that belong to a batch (scoped rows only,
  // so no cross-owner exposure). Runs share created_by with their batch.
  const batchIds = [...new Set((data ?? []).map((r) => r.audit_batch_id).filter((v): v is string => !!v))]
  const { data: batches } = batchIds.length
    ? await supabase.from('audit_batches').select('id, label').in('id', batchIds)
    : { data: [] }
  const labelByBatch = new Map((batches ?? []).map((b) => [b.id, b.label]))

  // Resolve who ran each audit (created_by → admin display name). Include the
  // active runBy filter so its chip name resolves even if the folder+runBy
  // combination currently yields no rows.
  const creatorIdSet = new Set((data ?? []).map((r) => r.created_by).filter((v): v is string => !!v))
  if (runByFilter) creatorIdSet.add(runByFilter)
  const creatorIds = [...creatorIdSet]
  const { data: creators } = creatorIds.length
    ? await supabase.from('admins').select('id, name, email').in('id', creatorIds)
    : { data: [] }
  const nameByCreator = new Map((creators ?? []).map((a) => [a.id, a.name || a.email]))
  const runByName = runByFilter ? nameByCreator.get(runByFilter) ?? 'Unknown user' : null

  const rows: AuditRow[] = (data ?? []).map((r) => ({
    id: r.id,
    url: r.url,
    domain: r.domain,
    site_name: r.site_name,
    audit_status: r.audit_status,
    overall_score: r.overall_score,
    overall_grade: r.overall_grade,
    pages_crawled: r.pages_crawled,
    created_at: r.created_at,
    batchId: r.audit_batch_id,
    batchLabel: r.audit_batch_id ? labelByBatch.get(r.audit_batch_id) ?? null : null,
    group: r.audit_group,
    runBy: r.created_by ? nameByCreator.get(r.created_by) ?? null : null,
    runById: r.created_by,
  }))
  const deltas = computeDeltas(rows)

  // KPI + chart metrics, derived from the rows already fetched — no new queries.
  const overview = auditsOverview(rows)
  const completedRows = rows.filter((r) => r.audit_status === 'complete' && r.overall_score !== null)
  const avgScore = completedRows.length
    ? Math.round(completedRows.reduce((sum, r) => sum + (r.overall_score ?? 0), 0) / completedRows.length)
    : null
  const inProgress = rows.filter((r) => r.audit_status !== 'complete' && r.audit_status !== 'error').length
  const erroredCount = rows.filter((r) => r.audit_status === 'error').length

  const FOLDER_TABS = [
    ['all', 'All'],
    ['prospect', 'Prospect'],
    ['working', 'Working'],
    ['client', 'Client'],
  ] as const

  return (
    <main className="mx-auto max-w-[1260px] p-8 pb-14">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-heading text-[27px] font-bold leading-tight text-brand-navy">Site Audits</h1>
          <p className="mt-1.5 font-body text-sm text-text-secondary">
            {folderCounts.all} audit{folderCounts.all === 1 ? '' : 's'} across prospect, working &amp; client
            {runByName && <span> · run by {runByName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user && hasCapability(user, 'auditor') && (
            <Link
              href="/admin/audits/batch/new"
              className="rounded-pill border border-border-default px-4 py-2.5 font-heading text-[13px] font-semibold text-text-secondary transition-all hover:bg-surface-subtle"
            >
              Batch audit
            </Link>
          )}
          <Link
            href="/admin/audits/new"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-cyan px-4 py-2.5 font-heading text-[13px] font-semibold text-text-inverse shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New audit
          </Link>
        </div>
      </div>

      {folderCounts.all === 0 && !runByFilter ? (
        <div className="rounded-xl border border-border-default bg-surface-card p-12 text-center shadow-subtle">
          <h2 className="font-heading text-lg font-semibold text-brand-navy">No audits yet</h2>
          <p className="mx-auto mt-1 max-w-sm font-body text-sm text-text-secondary">
            Run a site audit to score any website across nine categories and generate a shareable
            report.
          </p>
          <Link
            href="/admin/audits/new"
            className="mt-5 inline-block rounded-pill bg-brand-cyan px-4 py-2.5 font-heading text-[13px] font-semibold text-text-inverse shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow"
          >
            Run your first audit
          </Link>
        </div>
      ) : (
        <>
          {/* KPI cards — same at-a-glance band as the onboarding dashboard */}
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total audits"
              value={folderCounts[folder]}
              context={folder === 'all' ? 'across all folders' : `in ${folder}`}
            />
            <StatCard
              label="Completed"
              value={overview.completed}
              context="scored reports"
              tone={overview.completed > 0 ? 'good' : 'muted'}
            />
            <StatCard
              label="Average score"
              value={avgScore ?? '—'}
              context={completedRows.length ? `${completedRows.length} scored` : 'no scores yet'}
            />
            <StatCard
              label="In progress"
              value={inProgress}
              context={erroredCount > 0 ? `${erroredCount} errored` : 'running now'}
            />
          </div>

          {/* Filters — segmented pill control + active runner chip */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-pill border border-border-default bg-surface-card p-1">
              {FOLDER_TABS.map(([key, label]) => (
                <Link
                  key={key}
                  href={auditsHref(key, runByFilter)}
                  className={`rounded-pill px-3.5 py-1.5 font-heading text-[12.5px] font-semibold transition-colors ${
                    folder === key ? 'bg-brand-navy text-text-inverse' : 'text-text-secondary hover:bg-surface-subtle'
                  }`}
                >
                  {label} <span className="opacity-70">{folderCounts[key]}</span>
                </Link>
              ))}
            </div>
            {runByFilter && (
              <span className="inline-flex items-center gap-2 rounded-badge bg-brand-cyan/10 px-3 py-1 font-heading text-xs font-semibold text-brand-cyan-dark">
                Run by: {runByName}
                <Link
                  href={auditsHref(folder, null)}
                  aria-label="Clear runner filter"
                  className="leading-none text-brand-cyan-dark transition-colors hover:text-brand-navy"
                >
                  ✕
                </Link>
              </span>
            )}
            <div className="flex-1" />
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-border-default bg-surface-card p-12 text-center shadow-subtle">
              <p className="font-body text-sm text-text-secondary">No audits match this filter.</p>
            </div>
          ) : (
            <>
              <AuditsOverviewCharts overview={overview} />
              <AuditsTable rows={rows} deltas={deltas} showRunBy={user?.isAdmin ?? false} />
            </>
          )}
        </>
      )}
    </main>
  )
}
