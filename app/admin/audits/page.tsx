import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { AuditStatusBadge, GradeBadge } from '@/components/admin/audit/AuditBadges'

export const runtime = 'nodejs'

type AuditRow = {
  id: string
  url: string
  domain: string
  site_name: string | null
  audit_status: string
  overall_score: number | null
  overall_grade: string | null
  pages_crawled: number | null
  created_at: string
}

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
          className="rounded-pill bg-brand-cyan px-6 py-3 font-heading text-sm font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark"
        >
          New audit
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-surface-card p-12 text-center shadow-subtle">
          <p className="font-body text-sm text-text-secondary">
            No audits yet. Run your first one to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-subtle">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10 text-left">
                  {['Site', 'Date', 'Status', 'Pages', 'Score', 'Δ'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const delta = deltas[r.id]
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-border-default last:border-0 hover:bg-brand-cyan/10 ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/admin/audits/${r.id}`} className="block">
                          <span className="font-heading font-semibold text-brand-cyan hover:underline">
                            {r.site_name || r.domain}
                          </span>
                          <span className="block text-xs text-text-muted">{r.domain}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {new Date(r.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <AuditStatusBadge status={r.audit_status} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{r.pages_crawled ?? '—'}</td>
                      <td className="px-4 py-3">
                        <GradeBadge
                          grade={(r.overall_grade as 'A' | 'B' | 'C' | 'D' | 'F' | null) ?? null}
                          score={r.overall_score}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {delta === null || delta === undefined ? (
                          <span className="text-xs text-text-muted">—</span>
                        ) : (
                          <span
                            className={`text-xs font-heading font-semibold ${delta >= 0 ? 'text-success' : 'text-error'}`}
                          >
                            {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : '0'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}
