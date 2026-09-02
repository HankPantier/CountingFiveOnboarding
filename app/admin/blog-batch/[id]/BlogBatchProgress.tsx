'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  BlogBatchStatusResponse,
  BlogBatchTargetStatus,
} from '@/app/api/blog-batches/[id]/status/route'
import type { ClientOption } from '../new/NewBatchFlow'
import DeleteBatchButton from '../DeleteBatchButton'
import AddClientsPanel from './AddClientsPanel'

const STATUS_META: Record<BlogBatchTargetStatus, { icon: string; cls: string; label: string }> = {
  pending: { icon: '○', cls: 'text-text-muted', label: 'Queued' },
  generating: { icon: '◌', cls: 'text-brand-cyan-dark animate-pulse', label: 'Writing…' },
  complete: { icon: '●', cls: 'text-success', label: 'Drafted' },
  error: { icon: '✗', cls: 'text-error', label: 'Error' },
  skipped: { icon: '–', cls: 'text-text-muted', label: 'Skipped' },
}

export default function BlogBatchProgress({
  batchId,
  isAdmin,
  eligibleClients,
}: {
  batchId: string
  isAdmin: boolean
  eligibleClients: ClientOption[]
}) {
  const [data, setData] = useState<BlogBatchStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  // Bumped after a retry/add to restart polling (the interval self-stops at rest).
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

  async function retryFailed(sessionId?: string) {
    if (sessionId) setRetryingId(sessionId)
    else setRetrying(true)
    try {
      const res = await fetch(`/api/blog-batches/${batchId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionId ? { sessionId } : {}),
      })
      if (res.ok) setReloadNonce((n) => n + 1)
    } catch {
      // Transient — the user can click again.
    } finally {
      if (sessionId) setRetryingId(null)
      else setRetrying(false)
    }
  }

  // Re-draft an already-complete client with the batch's current (possibly
  // reclassified) content type — overwrites that client's existing draft.
  async function regenerateOne(sessionId: string) {
    setRegeneratingId(sessionId)
    try {
      const res = await fetch(`/api/blog-batches/${batchId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, force: true }),
      })
      if (res.ok) setReloadNonce((n) => n + 1)
    } catch {
      // Transient — the user can click again.
    } finally {
      setRegeneratingId(null)
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
        {isAdmin && <DeleteBatchButton batchId={batchId} redirect="/admin/blog-batch" />}
      </div>
      <h1 className="text-2xl font-heading font-bold text-brand-navy mb-1">{data.title}</h1>
      <p className="text-text-secondary font-body text-sm mb-6">
        {data.targetKeyword ? `Keyword: ${data.targetKeyword} · ` : ''}
        {counts.complete}/{counts.total} drafted
        {counts.error > 0 ? ` · ${counts.error} error${counts.error === 1 ? '' : 's'}` : ''}
        {counts.skipped > 0 ? ` · ${counts.skipped} skipped` : ''}
        {counts.inFlight > 0 ? ' · generating…' : ''}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <AddClientsPanel
          batchId={batchId}
          clients={eligibleClients}
          onAdded={() => setReloadNonce((n) => n + 1)}
        />

        {counts.error > 0 && counts.inFlight === 0 && (
          <button
            type="button"
            onClick={() => retryFailed()}
            disabled={retrying}
            className="mb-6 rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {retrying ? 'Retrying…' : `Retry ${counts.error} failed`}
          </button>
        )}
      </div>

      {counts.total === 0 ? (
        <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle px-4 py-10 text-center text-text-muted font-body text-sm">
          No clients in this batch yet. Use “Add clients” above to fan this idea out, or delete the batch.
        </div>
      ) : (
        <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-default bg-surface-header">
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-text-secondary font-heading font-semibold text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.targets.map((t) => {
                const meta = STATUS_META[t.status]
                return (
                  <tr
                    key={t.sessionId}
                    className="border-b border-border-default last:border-0 hover:bg-surface-subtle"
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
                        <div className="inline-flex items-center gap-2">
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
                          {counts.inFlight === 0 && (
                            <button
                              type="button"
                              onClick={() => regenerateOne(t.sessionId)}
                              disabled={regeneratingId === t.sessionId}
                              title="Re-draft this client with the batch's current content type (overwrites the existing draft)"
                              className="inline-flex items-center border border-brand-cyan/40 text-brand-cyan-dark font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {regeneratingId === t.sessionId ? 'Regenerating…' : 'Regenerate'}
                            </button>
                          )}
                        </div>
                      )}
                      {t.status === 'error' && counts.inFlight === 0 && (
                        <button
                          type="button"
                          onClick={() => retryFailed(t.sessionId)}
                          disabled={retryingId === t.sessionId}
                          className="inline-flex items-center border border-brand-cyan/40 text-brand-cyan-dark font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {retryingId === t.sessionId ? 'Retrying…' : 'Retry'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
