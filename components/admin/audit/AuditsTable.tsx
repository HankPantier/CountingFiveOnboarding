'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuditStatusBadge, GradeBadge, FolderBadge } from '@/components/admin/audit/AuditBadges'
import ListSearchInput from '@/components/admin/ListSearchInput'

export type AuditRow = {
  id: string
  url: string
  domain: string
  site_name: string | null
  audit_status: string
  overall_score: number | null
  overall_grade: string | null
  pages_crawled: number | null
  created_at: string
  batchId: string | null
  batchLabel: string | null
  group: string
  runBy: string | null
  runById: string | null
}

type SortKey = 'site' | 'batch' | 'folder' | 'runby' | 'date' | 'status' | 'pages' | 'score'
// null key = non-sortable column (the per-domain Δ is derived, not row data).
// The 'Run by' column is admin-only (auditors only see their own audits).
const ALL_COLUMNS: { key: SortKey | null; label: string; adminOnly?: boolean }[] = [
  { key: 'site', label: 'Site' },
  { key: 'batch', label: 'Batch' },
  { key: 'folder', label: 'Folder' },
  { key: 'runby', label: 'Run by', adminOnly: true },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'pages', label: 'Pages' },
  { key: 'score', label: 'Score' },
  { key: null, label: 'Δ' },
]

// Text columns default to ascending, numeric/date to descending, on first click.
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  site: 'asc',
  batch: 'asc',
  folder: 'asc',
  runby: 'asc',
  status: 'asc',
  date: 'desc',
  pages: 'desc',
  score: 'desc',
}

// Folder sorts by lifecycle order, not alphabetically.
const GROUP_RANK: Record<string, number> = { prospect: 0, working: 1, client: 2 }
const AUDIT_GROUPS = ['prospect', 'working', 'client'] as const

function batchSortValue(r: AuditRow): string | null {
  return r.batchId ? (r.batchLabel || 'untitled batch').toLowerCase() : null
}

function sortRows(rows: AuditRow[], key: SortKey, dir: 'asc' | 'desc'): AuditRow[] {
  const mul = dir === 'asc' ? 1 : -1
  // Nulls always sort last, regardless of direction.
  const nullsLast = <T,>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number => {
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return cmp(a, b) * mul
  }
  const str = (a: string, b: string) => a.localeCompare(b)
  const num = (a: number, b: number) => a - b
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'site':
        return str((a.site_name || a.domain).toLowerCase(), (b.site_name || b.domain).toLowerCase()) * mul
      case 'batch':
        return nullsLast(batchSortValue(a), batchSortValue(b), str)
      case 'folder':
        return num(GROUP_RANK[a.group] ?? 0, GROUP_RANK[b.group] ?? 0) * mul
      case 'runby':
        return nullsLast(a.runBy?.toLowerCase() ?? null, b.runBy?.toLowerCase() ?? null, str)
      case 'date':
        return str(a.created_at, b.created_at) * mul
      case 'status':
        return str(a.audit_status, b.audit_status) * mul
      case 'pages':
        return nullsLast(a.pages_crawled, b.pages_crawled, num)
      case 'score':
        return nullsLast(a.overall_score, b.overall_score, num)
    }
  })
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
    </svg>
  )
}

export default function AuditsTable({
  rows,
  deltas,
  showRunBy = false,
}: {
  rows: AuditRow[]
  deltas: Record<string, number | null>
  showRunBy?: boolean
}) {
  const router = useRouter()
  const columns = useMemo(() => ALL_COLUMNS.filter((c) => showRunBy || !c.adminOnly), [showRunBy])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const headerRef = useRef<HTMLInputElement>(null)
  // Default order matches the server query (newest first).
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.site_name, r.domain, r.url].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [rows, query])

  const sortedRows = useMemo(() => sortRows(filteredRows, sort.key, sort.dir), [filteredRows, sort])

  const onSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] },
    )
  }

  const allSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id))
  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate = selected.size > 0 && !allSelected
    }
  }, [selected, allSelected])

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((r) => prev.has(r.id))
      if (allVisibleSelected) {
        const next = new Set(prev)
        filteredRows.forEach((r) => next.delete(r.id))
        return next
      }
      const next = new Set(prev)
      filteredRows.forEach((r) => next.add(r.id))
      return next
    })
  }

  const deleteIds = async (ids: string[], confirmMsg: string) => {
    if (ids.length === 0 || !confirm(confirmMsg)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/audits', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const data = (await res.json()) as { deleted?: number; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Delete failed. Please try again.')
        return
      }
      setSelected(new Set())
      router.refresh()
    } catch {
      setError('Delete failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const moveTo = async (group: (typeof AUDIT_GROUPS)[number]) => {
    if (selected.size === 0) return
    // Folders track the business, so this moves every audit sharing the selected
    // sites' domains — make that explicit before acting.
    if (!confirm(`Move all audits for the selected site(s) to "${group}"?`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/audits/group', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], group }),
      })
      const data = (await res.json()) as { moved?: number; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Move failed. Please try again.')
        return
      }
      setSelected(new Set())
      router.refresh()
    } catch {
      setError('Move failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const dangerButton =
    'rounded-pill border border-error/50 px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div>
      <div className="mb-3 flex min-h-[2rem] items-center gap-4">
        <ListSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by site or domain…"
          ariaLabel="Search audits by site or domain"
        />
        <div className="flex-1" />
        {selected.size > 0 ? (
          <>
            <span className="font-body text-sm text-text-secondary">{selected.size} selected</span>
            <span className="font-body text-xs text-text-muted">Move to</span>
            {AUDIT_GROUPS.map((g) => (
              <button
                key={g}
                onClick={() => moveTo(g)}
                disabled={busy}
                className="rounded-pill border border-border-default px-3 py-1 font-heading text-xs font-semibold capitalize text-text-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                {g}
              </button>
            ))}
            <button
              onClick={() =>
                deleteIds(
                  [...selected],
                  `Delete ${selected.size} audit run${selected.size === 1 ? '' : 's'}? This cannot be undone.`,
                )
              }
              disabled={busy}
              className={dangerButton}
            >
              {busy ? 'Deleting…' : 'Delete selected'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={busy}
              className="font-body text-xs text-text-muted underline-offset-2 hover:text-text-primary hover:underline disabled:opacity-50"
            >
              Clear
            </button>
          </>
        ) : null}
        {error && <span className="font-body text-sm text-error">{error}</span>}
      </div>

      <div className="overflow-hidden rounded-xl border border-border-default bg-surface-card shadow-subtle">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-default bg-surface-header text-left">
                <th className="w-10 px-4 py-3">
                  <input
                    ref={headerRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all audits"
                    className="accent-brand-cyan"
                  />
                </th>
                {columns.map(({ key, label }) => (
                  <th
                    key={label}
                    className="whitespace-nowrap px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary"
                  >
                    {key ? (
                      <button
                        type="button"
                        onClick={() => onSort(key)}
                        aria-label={`Sort by ${label}`}
                        className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-brand-cyan"
                      >
                        {label}
                        <span className={`text-[10px] ${sort.key === key ? 'text-brand-cyan' : 'text-text-muted/40'}`}>
                          {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
                <th className="w-12 px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-12 text-center font-body text-text-muted">
                    No audits match “{query.trim()}”.
                  </td>
                </tr>
              )}
              {sortedRows.map((r) => {
                const delta = deltas[r.id]
                const isChecked = selected.has(r.id)
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-border-default last:border-0 hover:bg-surface-subtle ${isChecked ? 'bg-brand-cyan/10' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(r.id)}
                        aria-label={`Select ${r.site_name || r.domain}`}
                        className="accent-brand-cyan"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/audits/${r.id}`} className="block">
                        <span className="font-heading font-semibold text-brand-navy transition-colors hover:text-brand-cyan">
                          {r.site_name || r.domain}
                        </span>
                        <span className="block text-xs text-text-muted">{r.domain}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.batchId ? (
                        <Link
                          href={`/admin/audits/batch/${r.batchId}`}
                          className="font-heading text-xs font-semibold text-brand-navy transition-colors hover:text-brand-cyan"
                        >
                          {r.batchLabel || 'Untitled batch'}
                        </Link>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <FolderBadge group={r.group} />
                    </td>
                    {showRunBy && (
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.runById && r.runBy ? (
                          <Link
                            href={`/admin/audits?runBy=${r.runById}`}
                            title={`Show all audits by ${r.runBy}`}
                            className="inline-flex items-center rounded-badge bg-surface-subtle px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] text-text-secondary transition-colors hover:bg-brand-cyan/10 hover:text-brand-cyan-dark"
                          >
                            {r.runBy}
                          </Link>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-text-secondary">
                      {new Date(r.created_at).toLocaleDateString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <AuditStatusBadge status={r.audit_status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{r.pages_crawled ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <GradeBadge score={r.overall_score} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {delta === null || delta === undefined ? (
                        <span className="text-xs text-text-muted" title="First audit for this site">
                          —
                        </span>
                      ) : delta === 0 ? (
                        <span className="text-xs text-text-muted" title="No change since last audit">
                          ±0
                        </span>
                      ) : (
                        <span
                          className={`text-xs font-heading font-semibold ${delta > 0 ? 'text-success' : 'text-error'}`}
                          title={`${delta > 0 ? '+' : ''}${delta} since last audit`}
                        >
                          {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          deleteIds([r.id], 'Delete this audit run? This cannot be undone.')
                        }
                        disabled={busy}
                        title="Delete audit"
                        aria-label={`Delete ${r.site_name || r.domain}`}
                        className="text-text-muted transition-colors hover:text-error disabled:opacity-50"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
