'use client'

import { useState, useEffect } from 'react'

type PageStatus = {
  url: string
  title: string
  status: string
  parent?: string
  errorMessage?: string | null
}

// Depth in the sitemap tree, counted by walking the parent chain. Capped to
// guard against accidental cycles in user-edited sitemaps.
function depthOf(url: string, parentByUrl: Map<string, string | undefined>): number {
  let d = 0
  let cur = parentByUrl.get(url)
  while (cur && d < 8) {
    d++
    cur = parentByUrl.get(cur)
  }
  return d
}

type ResearchStatus = {
  total: number
  complete: number
  running: number
  error: number
  pages: PageStatus[]
}

const STATUS_ICONS: Record<string, { icon: string; cls: string }> = {
  pending:  { icon: '○', cls: 'text-text-muted' },
  running:  { icon: '◌', cls: 'text-blue-500 animate-pulse' },
  complete: { icon: '●', cls: 'text-green-600' },
  error:    { icon: '✗', cls: 'text-red-500' },
}

export default function ResearchPhase({
  contentJobId,
}: {
  contentJobId: string
}) {
  const [status, setStatus] = useState<ResearchStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [retryError, setRetryError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval>

    const poll = async () => {
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/research-status`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        setStatus(data)
        setLoading(false)
        // Self-terminate when all pages are done
        if (data.total > 0 && data.complete + data.error >= data.total) {
          clearInterval(intervalId)
        }
      } catch {
        // Retry on next poll
      }
    }

    poll()
    intervalId = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(intervalId) }
  }, [contentJobId, retryNonce])

  const retryFailed = async () => {
    setRetrying(true)
    setRetryError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/research/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Retry failed')
      }
      // Re-mount polling so it picks up the now-pending rows.
      setRetryNonce(n => n + 1)
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">Loading research status...</div>
      </div>
    )
  }

  if (!status || status.total === 0) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">No research tasks found. Confirm the sitemap first.</div>
      </div>
    )
  }

  const pct = status.total > 0 ? Math.round((status.complete / status.total) * 100) : 0
  const isRunning = status.running > 0 || (status.complete + status.error < status.total)

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-body text-text-primary font-semibold">
            {status.complete} of {status.total} pages researched
          </span>
          <span className="text-xs font-body text-text-muted">
            {isRunning ? 'In progress...' : 'Complete'}
            {status.error > 0 && ` · ${status.error} error${status.error !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="w-full h-2 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              status.error > 0 && !isRunning ? 'bg-amber-400' : 'bg-brand-cyan'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Page status list */}
      <div className="max-h-[300px] overflow-y-auto space-y-1">
        {(() => {
          const parentByUrl = new Map(status.pages.map(p => [p.url, p.parent]))
          return status.pages.map(page => {
            const s = STATUS_ICONS[page.status] ?? STATUS_ICONS.pending
            const depth = depthOf(page.url, parentByUrl)
            return (
              <div
                key={page.url}
                className="rounded hover:bg-surface-subtle transition-colors"
                style={{ paddingLeft: `${0.75 + depth * 1.25}rem`, paddingRight: '0.75rem' }}
              >
                <div className="flex items-center gap-2 py-1.5">
                  <span className={`text-sm ${s.cls}`}>{s.icon}</span>
                  <span className="text-sm font-body text-text-primary flex-1 truncate">{page.title}</span>
                  <span className="text-xs font-mono text-text-muted flex-shrink-0">{page.url}</span>
                </div>
                {page.errorMessage && (
                  <div className="text-xs font-body text-red-600 pl-6 pb-1.5 -mt-1">
                    {page.errorMessage}
                  </div>
                )}
              </div>
            )
          })
        })()}
      </div>

      {status.error > 0 && !isRunning && (() => {
        const firstError = status.pages.find(p => p.errorMessage)?.errorMessage
        return (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-body rounded-lg px-4 py-2 space-y-1">
            <div>
              {status.complete} complete · {status.error} errors — generation will proceed with available research.
            </div>
            {firstError && (
              <div className="text-xs text-amber-900 font-mono break-words">
                First error: {firstError}
              </div>
            )}
          </div>
        )
      })()}

      {retryError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-body rounded-lg px-4 py-2">
          {retryError}
        </div>
      )}

      {status.error > 0 && (
        <button
          onClick={retryFailed}
          disabled={retrying}
          className="border border-border-default text-text-secondary font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {retrying ? 'Retrying...' : 'Retry failed pages'}
        </button>
      )}
    </div>
  )
}
