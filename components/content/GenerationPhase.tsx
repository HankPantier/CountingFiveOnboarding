'use client'

import { useState, useEffect } from 'react'

type PageStatus = {
  url: string
  title: string
  status: string
}

type GenStatus = {
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

export default function GenerationPhase({
  contentJobId,
}: {
  contentJobId: string
}) {
  const [status, setStatus] = useState<GenStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval>

    const poll = async () => {
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/generation-status`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        setStatus(data)
        setLoading(false)
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
  }, [contentJobId])

  if (loading) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">Loading generation status...</div>
      </div>
    )
  }

  if (!status || status.total === 0) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">No pages queued for generation.</div>
      </div>
    )
  }

  const pct = status.total > 0 ? Math.round((status.complete / status.total) * 100) : 0
  const isRunning = status.running > 0 || (status.complete + status.error < status.total)

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-body text-text-primary font-semibold">
            {status.complete} of {status.total} pages generated
          </span>
          <span className="text-xs font-body text-text-muted">
            {isRunning ? 'Generating...' : 'Complete'}
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

      <div className="max-h-[300px] overflow-y-auto space-y-1">
        {status.pages.map(page => {
          const s = STATUS_ICONS[page.status] ?? STATUS_ICONS.pending
          return (
            <div
              key={page.url}
              className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-surface-subtle transition-colors"
            >
              <span className={`text-sm ${s.cls}`}>{s.icon}</span>
              <span className="text-sm font-body text-text-primary flex-1 truncate">{page.title}</span>
              <span className="text-xs font-mono text-text-muted flex-shrink-0">{page.url}</span>
            </div>
          )
        })}
      </div>

      {status.error > 0 && !isRunning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-body rounded-lg px-4 py-2">
          {status.complete} pages generated · {status.error} failed — deliverables will include an ERRORS.md noting skipped pages.
        </div>
      )}

      {!isRunning && status.complete > 0 && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-body rounded-lg px-4 py-2">
          Content generation complete. Proceed to Deliverables to download the content package.
        </div>
      )}
    </div>
  )
}
