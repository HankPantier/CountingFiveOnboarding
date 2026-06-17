import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import AuditsTable, { type AuditRow } from '@/components/admin/audit/AuditsTable'

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

export default async function AuditsListPage() {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('audit_runs')
    .select(
      'id, url, domain, site_name, audit_status, overall_score, overall_grade, pages_crawled, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as AuditRow[]
  const deltas = computeDeltas(rows)

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-brand-navy">Site Audits</h1>
          <p className="mt-1 font-body text-sm text-text-secondary">
            {rows.length} run{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/admin/audits/new"
          className="rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark"
        >
          New audit
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-surface-card p-12 text-center shadow-subtle">
          <h2 className="font-heading text-lg font-semibold text-brand-navy">No audits yet</h2>
          <p className="mx-auto mt-1 max-w-sm font-body text-sm text-text-secondary">
            Run a site audit to score any website across nine categories and generate a shareable
            report.
          </p>
          <Link
            href="/admin/audits/new"
            className="mt-5 inline-block rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark"
          >
            Run your first audit
          </Link>
        </div>
      ) : (
        <AuditsTable rows={rows} deltas={deltas} />
      )}
    </main>
  )
}
