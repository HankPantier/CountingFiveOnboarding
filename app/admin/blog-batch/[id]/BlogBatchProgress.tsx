'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  BlogBatchStatusResponse,
  BlogBatchTargetStatus,
} from '@/app/api/blog-batches/[id]/status/route'

const STATUS_META: Record<BlogBatchTargetStatus, { icon: string; cls: string; label: string }> = {
  pending: { icon: '○', cls: 'text-text-muted', label: 'Queued' },
  generating: { icon: '◌', cls: 'text-info animate-pulse', label: 'Writing…' },
  complete: { icon: '●', cls: 'text-success', label: 'Drafted' },
  error: { icon: '✗', cls: 'text-error', label: 'Error' },
  skipped: { icon: '–', cls: 'text-text-muted', label: 'Skipped' },
}

export default function BlogBatchProgress({ batchId }: { batchId: string }) {
  const [data, setData] = useState<BlogBatchStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // Bumped after a retry to restart polling (the interval self-stops at rest).
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let active = true
    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/blog-batches/${batchId}/status`)
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) {
            if (active) setNotFound(true)
            if (intervalId) clearInterval(intervalId)
          }
          return
        }
        const json = (await res.json()) as BlogBatchStatusResponse
        if (!active) return
        setData(json)
        setLoading(false)
        if (json.counts.inFlight === 0 && intervalId) clearInterval(intervalId)
      } catch {
        // Transient — the next tick retries.
      }
    }

    poll()
    intervalId = setInterval(poll, 5000)
    return () => {
      active = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [batchId, reloadNonce])

  async function retryFailed() {
    setRetrying(true)
    try {
      const res = await fetch(`/api/blog-batches/${batchId}/retry`, { method: 'POST' })
      if (res.ok) setReloadNonce((n) => n + 1)
    } catch {
      // Transient — the user can click again.
    } finally {
      setRetrying(false)
    }
  }

  if (notFound) {
    return (
      <main className="p-8">
        <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card">Batch not found or not accessible.</p>
        <Link href="/admin/blog-batch" className="text-brand-cyan text-sm hover:underline mt-4 inline-block">
          &larr; Back to batches
        </Link>
      </main>
    )
  }

  if (loading || !data) {
    return <main className="p-8 text-text-muted font-body text-sm">Loading…</main>
  }

  const { counts } = data

  return (
    <main className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-2">
        <Link href="/admin/blog-batch" className="text-brand-cyan text-sm hover:underline">
          &larr; Back to batches
        </Link>
      </div>
      <h1 className="text-2xl font-heading font-bold text-brand-navy mb-1">{data.title}</h1>
      <p className="text-text-secondary font-body text-sm mb-6">
        {data.targetKeyword ? `Keyword: ${data.targetKeyword} · ` : ''}
        {counts.complete}/{counts.total} drafted
        {counts.error > 0 ? ` · ${counts.error} error${counts.error === 1 ? '' : 's'}` : ''}
        {counts.skipped > 0 ? ` · ${counts.skipped} skipped` : ''}
        {counts.inFlight > 0 ? ' · generating…' : ''}
      </p>

      {counts.error > 0 && counts.inFlight === 0 && (
        <button
          type="button"
          onClick={retryFailed}
          disabled={retrying}
          className="mb-6 bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-5 py-2.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {retrying ? 'Retrying…' : `Retry ${counts.error} failed`}
        </button>
      )}

      <div className="bg-surface-card border border-border-default rounded-lg shadow-subtle overflow-hidden">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10">
              <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Client</th>
              <th className="text-left px-4 py-3 text-brand-navy font-heading font-semibold text-xs uppercase tracking-wide">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.targets.map((t, i) => {
              const meta = STATUS_META[t.status]
              return (
                <tr
                  key={t.sessionId}
                  className={`border-b border-border-default last:border-0 ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-body text-text-primary font-semibold truncate">{t.firmName ?? t.websiteUrl}</div>
                    {t.firmName && <div className="text-text-muted text-xs mt-0.5 truncate">{t.websiteUrl}</div>}
                    {t.status === 'error' && t.error && (
                      <div className="text-error text-xs mt-1">{t.error}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-heading font-semibold ${meta.cls}`}>
                      <span>{meta.icon}</span>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status === 'complete' && (
                      <Link
                        href={
                          t.draftPath
                            ? `/admin/content/${t.sessionId}/edit?path=${encodeURIComponent(t.draftPath)}`
                            : `/admin/content/${t.sessionId}/edit`
                        }
                        className="inline-flex items-center border border-success/40 text-success font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-success/10"
                      >
                        Open draft
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
