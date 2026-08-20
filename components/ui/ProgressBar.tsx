'use client'

import { useEffect, useState } from 'react'

// Shared progress primitive for long-running operations. Determinate (a real
// fill) when `total > 0`; otherwise an indeterminate sliding fill. Always shows
// a phase label and either the count (x/y) or an elapsed timer, so the user can
// see the process is alive even when we can't compute a percentage.
export default function ProgressBar({
  phase,
  current,
  total,
  startedAt,
  className = '',
}: {
  phase?: string | null
  current: number
  total: number
  // ms epoch the operation started — drives the elapsed timer shown when there
  // is no determinate count. Omit to hide the timer.
  startedAt?: number | null
  className?: string
}) {
  const determinate = total > 0
  const pct = determinate ? Math.min(100, Math.round((current / total) * 100)) : 0

  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    if (determinate || !startedAt) return
    const fmt = () => {
      const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    }
    fmt()
    const iv = setInterval(fmt, 1000)
    return () => clearInterval(iv)
  }, [determinate, startedAt])

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-body text-text-secondary truncate">{phase ?? 'Working…'}</span>
        <span className="text-[11px] font-mono text-text-muted tabular-nums flex-shrink-0">
          {determinate ? `${current}/${total}` : elapsed}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={determinate ? pct : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={phase ?? 'Working'}
        className="h-1.5 w-full rounded-full bg-surface-subtle overflow-hidden"
      >
        {determinate ? (
          <div className="h-full rounded-full bg-brand-cyan transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 rounded-full bg-brand-cyan animate-progress-slide" />
        )}
      </div>
    </div>
  )
}
