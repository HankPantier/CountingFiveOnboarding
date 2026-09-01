'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_OPTIONS,
  asContentType,
  type ContentType,
} from '@/lib/content/content-types'
import { INDUSTRIES, INDUSTRY_OPTIONS, asIndustry, type Industry } from '@/lib/content/industries'
import DeleteBatchButton from './DeleteBatchButton'

export interface BatchContentRow {
  id: string
  title: string
  targetKeyword: string | null
  status: string
  contentType: string | null
  industry: string | null
  createdAt: string
  clientsTotal: number
  clientsComplete: number
}

type SortKey = 'title' | 'clients' | 'created' | 'status'
type SortDir = 'asc' | 'desc'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-success/10 text-success',
    error: 'bg-error/10 text-error',
    generating: 'bg-brand-cyan/10 text-brand-cyan-dark',
  }
  const label: Record<string, string> = {
    complete: 'Complete',
    error: 'Error',
    generating: 'Generating',
  }
  return (
    <span
      className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${
        map[status] ?? 'bg-surface-subtle text-text-muted'
      }`}
    >
      {label[status] ?? status}
    </span>
  )
}

function TagBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-navy/10 px-2 py-0.5 text-[10px] font-heading font-semibold text-brand-navy">
      {children}
    </span>
  )
}

function pillClass(active: boolean): string {
  return `rounded-pill border font-heading font-semibold text-xs px-3 py-1 transition-all ${
    active
      ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan-dark'
      : 'border-border-default text-text-secondary hover:bg-surface-subtle'
  }`
}

// Rank used to order statuses when sorting the Status column.
const STATUS_RANK: Record<string, number> = { generating: 0, error: 1, complete: 2 }

function SortHeader({
  label,
  keyName,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string
  keyName: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === keyName
  return (
    <th className="text-left px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(keyName)}
        className={`inline-flex items-center gap-1 font-heading font-semibold text-xs uppercase tracking-wide transition-colors ${
          active ? 'text-brand-navy' : 'text-text-secondary hover:text-brand-navy'
        }`}
      >
        {label}
        <span className="text-[9px]">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}

export default function BatchContentTable({
  rows,
  isAdmin,
}: {
  rows: BatchContentRow[]
  isAdmin: boolean
}) {
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentType | 'all'>('all')
  const [industryFilter, setIndustryFilter] = useState<Industry | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Text sorts read best ascending; everything else defaults to descending.
      setSortDir(key === 'title' ? 'asc' : 'desc')
    }
  }

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (contentTypeFilter !== 'all' && asContentType(r.contentType) !== contentTypeFilter) return false
      if (industryFilter !== 'all' && asIndustry(r.industry) !== industryFilter) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'title':
          cmp = a.title.localeCompare(b.title)
          break
        case 'clients':
          cmp = a.clientsTotal - b.clientsTotal
          break
        case 'created':
          cmp = a.createdAt.localeCompare(b.createdAt)
          break
        case 'status':
          cmp = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99)
          break
      }
      if (cmp !== 0) return cmp * dir
      // Stable tiebreak on creation time (newest first) so equal keys don't jump.
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [rows, contentTypeFilter, industryFilter, sortKey, sortDir])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-xs font-semibold uppercase tracking-wide text-text-muted">
            Type
          </span>
          <button
            type="button"
            onClick={() => setContentTypeFilter('all')}
            className={pillClass(contentTypeFilter === 'all')}
          >
            All
          </button>
          {CONTENT_TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setContentTypeFilter(o.value)}
              className={pillClass(contentTypeFilter === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-xs font-semibold uppercase tracking-wide text-text-muted">
            Industry
          </span>
          <button
            type="button"
            onClick={() => setIndustryFilter('all')}
            className={pillClass(industryFilter === 'all')}
          >
            All
          </button>
          {INDUSTRY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setIndustryFilter(o.value)}
              className={pillClass(industryFilter === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <span className="ml-auto font-body text-xs text-text-muted">
          {visible.length} of {rows.length}
        </span>
      </div>

      <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle overflow-hidden">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-border-default bg-surface-header">
              <SortHeader label="Idea" keyName="title" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">
                Type
              </th>
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">
                Industry
              </th>
              <SortHeader label="Clients" keyName="clients" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Created" keyName="created" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Status" keyName="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-muted font-body">
                  No batches match these filters.
                </td>
              </tr>
            ) : (
              visible.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors"
                >
                  <td className="px-4 py-3 max-w-md">
                    <div className="font-body text-text-primary font-semibold truncate">{b.title}</div>
                    {b.targetKeyword && (
                      <div className="text-text-muted text-xs mt-0.5 truncate">{b.targetKeyword}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TagBadge>{CONTENT_TYPES[asContentType(b.contentType)].uiLabel}</TagBadge>
                  </td>
                  <td className="px-4 py-3">
                    <TagBadge>{INDUSTRIES[asIndustry(b.industry)].uiLabel}</TagBadge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {`${b.clientsTotal} client${b.clientsTotal === 1 ? '' : 's'} · ${b.clientsComplete} drafted`}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {new Date(b.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/blog-batch/${b.id}`}
                        className="inline-flex items-center rounded-pill border border-border-default text-text-secondary font-heading font-semibold text-[11px] px-2.5 py-1 transition-all hover:bg-surface-subtle"
                      >
                        View
                      </Link>
                      {isAdmin && <DeleteBatchButton batchId={b.id} size="sm" />}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
