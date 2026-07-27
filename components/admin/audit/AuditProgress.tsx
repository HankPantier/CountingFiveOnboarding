'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type StatusResponse = {
  audit_status: string
  status_detail: string | null
  pages_crawled: number | null
  error_message: string | null
}

const TERMINAL = ['complete', 'error']

// The crawl→render journey, in order, for the stepper.
const PHASES: Array<{ key: string; label: string }> = [
  { key: 'crawling', label: 'Crawling pages' },
  { key: 'analyzing', label: 'Analyzing content' },
  { key: 'scoring', label: 'Scoring categories' },
  { key: 'rendering', label: 'Building report' },
]

type StepState = 'done' | 'active' | 'pending'

function stepState(phaseKey: string, current: string): StepState {
  if (current === 'complete') return 'done'
  const order = ['queued', ...PHASES.map((p) => p.key)]
  const ci = order.indexOf(current)
  const pi = order.indexOf(phaseKey)
  if (ci > pi) return 'done'
  if (ci === pi) return 'active'
  return 'pending'
}

export function AuditProgress({
  auditId,
  initialStatus,
  initialStatusDetail = null,
  initialErrorMessage = null,
  initialPagesCrawled = null,
}: {
  auditId: string
  initialStatus: string
  initialStatusDetail?: string | null
  initialErrorMessage?: string | null
  initialPagesCrawled?: number | null
}) {
  const router = useRouter()
  // Seed from the server-rendered row so a fresh load of an ALREADY-terminal
  // audit shows its real status_detail / error_message — polling is skipped for
  // terminal states, so without this seed the card would fall back to generic
  // placeholder text and hide the actual failure reason.
  const [status, setStatus] = useState<StatusResponse>({
    audit_status: initialStatus,
    status_detail: initialStatusDetail,
    pages_crawled: initialPagesCrawled,
    error_message: initialErrorMessage,
  })
  const refreshed = useRef(false)

  // Depends only on auditId/router (both stable) so the interval is set up once
  // and not torn down/recreated on every status change.
  useEffect(() => {
    if (TERMINAL.includes(initialStatus)) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/audits/${auditId}/status`)
        if (cancelled || !res.ok) return
        const data: StatusResponse = await res.json()
        setStatus(data)
        if (TERMINAL.includes(data.audit_status)) {
          clearInterval(intervalId)
          // Re-render the server page so the completed report renders.
          if (!refreshed.current) {
            refreshed.current = true
            router.refresh()
          }
        }
      } catch {
        // retry on next tick
      }
    }

    const intervalId = setInterval(poll, 3000)
    poll()
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [auditId, initialStatus, router])

  const isError = status.audit_status === 'error'
  const isComplete = status.audit_status === 'complete'

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-lg border border-border-default bg-surface-card p-8 shadow-subtle">
        <div className="flex items-center gap-3">
          {!isError && !isComplete && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-cyan border-t-transparent" />
          )}
          <p className="font-heading text-lg font-semibold text-text-primary">
            {isError ? 'Audit failed' : isComplete ? 'Audit complete — loading report…' : 'Running audit'}
          </p>
        </div>
        <p className="mt-1 font-body text-sm text-text-secondary">
          {status.status_detail ?? 'Queued — starting shortly.'}
        </p>

        {!isError && (
          <ol className="mt-6 space-y-3">
            {PHASES.map((phase) => {
              const st = stepState(phase.key, status.audit_status)
              return (
                <li key={phase.key} className="flex items-center gap-3">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      st === 'done'
                        ? 'bg-success text-text-inverse'
                        : st === 'active'
                          ? 'bg-brand-cyan text-text-inverse'
                          : 'bg-surface-subtle text-text-muted'
                    }`}
                  >
                    {st === 'done' ? '✓' : ''}
                  </span>
                  <span
                    className={`font-body text-sm ${
                      st === 'pending' ? 'text-text-muted' : 'text-text-primary'
                    }`}
                  >
                    {phase.label}
                    {phase.key === 'crawling' &&
                      typeof status.pages_crawled === 'number' &&
                      status.pages_crawled > 0 &&
                      ` — ${status.pages_crawled} pages`}
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        {isError && (
          <p className="mt-4 rounded-lg bg-error/10 px-4 py-2 font-body text-sm text-error">
            {status.error_message ?? 'Something went wrong. Try re-running the audit.'}
          </p>
        )}
      </div>
    </div>
  )
}
