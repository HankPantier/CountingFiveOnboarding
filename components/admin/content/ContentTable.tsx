'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import GenerateContentModal from '@/components/admin/content/GenerateContentModal'
import ListSearchInput from '@/components/admin/ListSearchInput'

export type ContentRow = {
  id: string
  websiteUrl: string
  firmName: string | null
  approvedAt: string | null
  phase: number | null
  canEditContent: boolean
}

const CONTENT_PHASE_LABELS: Record<number, string> = {
  1: 'Palette',
  2: 'Sitemap',
  3: 'Research',
  4: 'Outlines',
  5: 'Generating',
  6: 'Complete',
}

function ContentPhaseBadge({ phase }: { phase: number | null }) {
  if (phase === null) {
    return (
      <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-surface-subtle text-text-muted">
        Not Started
      </span>
    )
  }
  if (phase === 6) {
    return (
      <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-success/10 text-success">
        Complete
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-brand-cyan/10 text-brand-cyan-dark">
      {CONTENT_PHASE_LABELS[phase] ?? `Phase ${phase}`}
    </span>
  )
}

export default function ContentTable({ rows }: { rows: ContentRow[] }) {
  const [query, setQuery] = useState('')

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.firmName, r.websiteUrl].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [rows, query])

  return (
    <div>
      <div className="mb-4 flex items-center">
        <ListSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by client or website…"
          ariaLabel="Search clients by name or website"
        />
      </div>

      <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle overflow-hidden">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-border-default bg-[#FBFCFD]">
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Firm / Website</th>
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Approved</th>
              <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Content Phase</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center font-body text-text-muted">
                  No clients match “{query.trim()}”.
                </td>
              </tr>
            )}
            {filteredRows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-body text-text-primary font-semibold">
                    {row.firmName ?? row.websiteUrl}
                  </div>
                  {row.firmName && (
                    <div className="text-text-muted text-xs mt-0.5">{row.websiteUrl}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {row.approvedAt
                    ? new Date(row.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <ContentPhaseBadge phase={row.phase} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <GenerateContentModal sessionId={row.id} contentComplete={row.phase === 6} />
                    {row.phase === 6 && (
                      row.canEditContent ? (
                        <Link
                          href={`/admin/content/${row.id}/edit`}
                          className="text-brand-navy hover:text-brand-cyan font-heading font-semibold text-xs transition-colors"
                          title="Edit published content in the linked GitHub repo"
                        >
                          Edit content ↗
                        </Link>
                      ) : (
                        <Link
                          href={`/admin/content/${row.id}`}
                          className="text-text-muted hover:text-brand-cyan font-heading font-semibold text-xs transition-colors"
                          title="Open the content workflow to connect a GitHub repo"
                        >
                          Connect repo →
                        </Link>
                      )
                    )}
                    <Link
                      href={`/admin/content/${row.id}`}
                      className={`inline-flex items-center font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all ${
                        row.phase === 6
                          ? 'border border-success/50 text-success hover:bg-success/10'
                          : 'bg-brand-cyan text-text-inverse hover:bg-brand-cyan-dark'
                      }`}
                    >
                      {row.phase === 6 ? 'Download' : row.phase !== null ? 'Continue' : 'Start'}
                      {row.phase !== null && row.phase !== 6 && <span className="ml-1">&rarr;</span>}
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
