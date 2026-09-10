'use client'

import { useRouter } from 'next/navigation'

type Option = { id: string; label: string }

// Build an audits-list URL, emitting only non-default dimensions. Mirrors the
// server-side auditsHref() in app/admin/audits/page.tsx.
function auditsHref(next: { folder: string; runBy: string | null; batch: string | null }): string {
  const p = new URLSearchParams()
  if (next.folder && next.folder !== 'all') p.set('folder', next.folder)
  if (next.runBy) p.set('runBy', next.runBy)
  if (next.batch) p.set('batch', next.batch)
  const qs = p.toString()
  return qs ? `/admin/audits?${qs}` : '/admin/audits'
}

const selectClass =
  'rounded-pill border border-border-default bg-surface-card px-3.5 py-1.5 pr-8 font-heading text-[12.5px] font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus:border-brand-cyan focus:outline-none'

export default function AuditFilters({
  folder,
  runBy,
  batch,
  runnerOptions = [],
  batchOptions,
  showRunBy,
}: {
  folder: string
  runBy: string | null
  batch: string | null
  runnerOptions?: Option[]
  batchOptions: Option[]
  showRunBy: boolean
}) {
  const router = useRouter()

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showRunBy && runnerOptions.length > 0 && (
        <select
          aria-label="Filter by who ran the audit"
          value={runBy ?? ''}
          onChange={(e) =>
            router.push(auditsHref({ folder, runBy: e.target.value || null, batch }))
          }
          className={selectClass}
        >
          <option value="">Run by: anyone</option>
          {runnerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {batchOptions.length > 0 && (
        <select
          aria-label="Filter by batch"
          value={batch ?? ''}
          onChange={(e) =>
            router.push(auditsHref({ folder, runBy, batch: e.target.value || null }))
          }
          className={selectClass}
        >
          <option value="">Any batch</option>
          {batchOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
