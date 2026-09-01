'use client'

import { useState } from 'react'
import type { EditStatRow } from '@/lib/content/edit-stats'

function fileLabel(row: EditStatRow): string {
  return row.url ?? row.path.split('/').pop() ?? row.path
}

function money(v: number): string {
  return `$${v.toFixed(2)}`
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const s = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

type SortKey = 'edits' | 'churn' | 'cost'

const th = 'px-3 py-2 text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide'
const td = 'px-3 py-2 font-body text-text-primary tabular-nums'

export default function EditStatsPanel({
  rows,
  truncated,
  loading,
  error,
  onRefresh,
}: {
  rows: EditStatRow[]
  truncated: boolean
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const [sort, setSort] = useState<SortKey>('edits')

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'cost') return (b.aiCostUsd ?? 0) - (a.aiCostUsd ?? 0)
    if (sort === 'churn') return b.additions + b.deletions - (a.additions + a.deletions)
    return b.editCount - a.editCount
  })

  const totalEdits = rows.reduce((s, r) => s + r.editCount, 0)
  const totalCost = rows.reduce((s, r) => s + (r.aiCostUsd ?? 0), 0)

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`${th} text-right hover:text-brand-navy transition-colors ${sort === key ? 'text-brand-navy' : ''}`}
    >
      {label}
      {sort === key ? ' ↓' : ''}
    </button>
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-brand-navy">Edit activity</h2>
          <p className="mt-0.5 text-xs font-body text-text-muted">
            How many times each page and resource has been edited (AI vs by hand), how much changed,
            and the AI spend — from this site&rsquo;s full edit history. Admin-only.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0 rounded-pill border border-border-default px-3.5 py-1.5 font-heading font-semibold text-xs text-text-secondary hover:bg-surface-subtle transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-body text-warning-strong">
          {error}
        </div>
      )}

      {truncated && (
        <div className="mb-4 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-body text-info">
          History is long — showing the most recent slice of commits, so older edits may be undercounted.
        </div>
      )}

      {!loading && rows.length === 0 && !error ? (
        <p className="py-10 text-center text-sm font-body text-text-muted">No edits recorded yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface-card shadow-subtle">
          <table className="w-full text-left">
            <thead className="bg-surface-header">
              <tr className="border-b border-border-default">
                <th className={th}>Page / resource</th>
                <th className={`${th} text-right`}>{sortBtn('edits', 'Edits')}</th>
                <th className={`${th} text-right`}>AI / manual</th>
                <th className={`${th} text-right`}>{sortBtn('churn', 'Lines ±')}</th>
                <th className={`${th} text-right`}>{sortBtn('cost', 'AI $')}</th>
                <th className={`${th} text-right`}>Last edit</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.path} className="border-b border-border-default last:border-0">
                  <td className="px-3 py-2 font-body text-text-primary">
                    <span className="truncate">{fileLabel(r)}</span>
                  </td>
                  <td className={`${td} text-right`}>{r.editCount}</td>
                  <td className={`${td} text-right text-text-secondary`}>
                    <span className="text-brand-cyan-dark">{r.aiCount} AI</span>
                    {' · '}
                    {r.manualCount} manual
                  </td>
                  <td className={`${td} text-right text-text-secondary`}>
                    <span className="text-success">+{r.additions}</span>{' '}
                    <span className="text-error">−{r.deletions}</span>
                  </td>
                  <td className={`${td} text-right`}>{money(r.aiCostUsd ?? 0)}</td>
                  <td className={`${td} text-right text-text-secondary`}>
                    {timeAgo(r.lastEditAt)}
                    {r.lastAuthorName ? ` · ${r.lastAuthorName}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-subtle">
                <td className="px-3 py-2 font-heading text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  {rows.length} pages
                </td>
                <td className={`${td} text-right font-semibold`}>{totalEdits}</td>
                <td />
                <td />
                <td className={`${td} text-right font-semibold`}>{money(totalCost)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
