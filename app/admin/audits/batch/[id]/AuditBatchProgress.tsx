'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AuditBatchStatusResponse, AuditBatchRunView } from '@/app/api/audit-batches/[id]/status/route'

const RUNNING_STATES = new Set(['crawling', 'analyzing', 'researching', 'scoring', 'rendering'])

function statusMeta(run: AuditBatchRunView): { icon: string; cls: string; label: string } {
  if (run.auditStatus === 'queued') return { icon: '○', cls: 'text-text-muted', label: 'Queued' }
  if (run.auditStatus === 'complete') return { icon: '●', cls: 'text-success', label: 'Complete' }
  if (run.auditStatus === 'error') return { icon: '✗', cls: 'text-error', label: 'Error' }
  if (RUNNING_STATES.has(run.auditStatus)) {
    return { icon: '◌', cls: 'text-info animate-pulse', label: run.statusDetail ?? 'Auditing…' }
  }
  return { icon: '○', cls: 'text-text-muted', label: run.auditStatus }
}

export default function AuditBatchProgress({ batchId }: { batchId: string }) {
  const [data, setData] = useState<AuditBatchStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/audit-batches/${batchId}/status`)
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) {
            if (active) setNotFound(true)
            if (intervalId) clearInterval(intervalId)
          }
          return
        }
        const json = (await res.json()) as AuditBatchStatusResponse
        if (!active) return
        setData(json)
        setLoading(false)
        if (json.counts.queued === 0 && json.counts.running === 0 && intervalId) clearInterval(intervalId)
      } catch {
        // Transient — the next tick retries.
      }
    }

    poll()
    intervalId = setInterval(poll, 2500)
    return () => {
      active = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [batchId])

  if (notFound) {
    return (
      <main className="p-8">
        <p className="rounded-card bg-error/10 px-3 py-2 text-sm text-error">Batch not found or not accessible.</p>
        <Link href="/admin/audits" className="mt-4 inline-block text-sm text-brand-cyan hover:underline">
          &larr; Back to audits
        </Link>
      </main>
    )
  }

  if (loading || !data) {
    return <main className="p-8 font-body text-sm text-text-muted">Loading…</main>
  }

  const { counts } = data
  const inFlight = counts.queued + counts.running

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/admin/audits" className="text-sm text-brand-cyan hover:underline">
        &larr; Back to audits
      </Link>
      <h1 className="mb-1 mt-2 font-heading text-2xl font-bold text-brand-navy">
        {data.label ?? 'Batch audit'}
      </h1>
      <p className="mb-6 font-body text-sm text-text-secondary">
        {counts.complete}/{counts.total} complete
        {counts.error > 0 ? ` · ${counts.error} error${counts.error === 1 ? '' : 's'}` : ''}
        {inFlight > 0 ? ' · running one at a time…' : ''}
      </p>

      <div className="overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-subtle">
        <table className="w-full font-body text-sm">
          <thead>
            <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10">
              <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
                Site
              </th>
              <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
                Status
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.runs.map((run, i) => {
              const meta = statusMeta(run)
              return (
                <tr
                  key={run.id}
                  className={`border-b border-border-default last:border-0 ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="truncate font-body font-semibold text-text-primary">{run.domain}</div>
                    <div className="mt-0.5 truncate text-xs text-text-muted">{run.url}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 font-heading text-xs font-semibold ${meta.cls}`}>
                      <span>{meta.icon}</span>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {run.auditStatus === 'complete' && (
                      <Link
                        href={`/admin/audits/${run.id}`}
                        className="inline-flex items-center rounded-pill border border-success/40 px-3.5 py-1.5 font-heading text-xs font-semibold text-success transition-all hover:bg-success/10"
                      >
                        {run.overallGrade ? `View report · ${run.overallGrade}` : 'View report'}
                      </Link>
                    )}
                    {run.auditStatus === 'error' && (
                      <Link
                        href={`/admin/audits/${run.id}`}
                        className="inline-flex items-center rounded-pill border border-border-default px-3.5 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-all hover:bg-surface-subtle"
                      >
                        Details
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}
