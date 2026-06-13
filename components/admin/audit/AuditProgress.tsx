'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuditStatusBadge } from './AuditBadges'

type StatusResponse = {
  audit_status: string
  status_detail: string | null
  pages_crawled: number | null
  error_message: string | null
}

const TERMINAL = ['complete', 'error']

export function AuditProgress({
  auditId,
  initialStatus,
}: {
  auditId: string
  initialStatus: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<StatusResponse>({
    audit_status: initialStatus,
    status_detail: null,
    pages_crawled: null,
    error_message: null,
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-lg border border-border-default bg-surface-card p-8 text-center shadow-subtle">
        <div className="flex items-center justify-center gap-3">
          {!isError && !TERMINAL.includes(status.audit_status) && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-cyan border-t-transparent" />
          )}
          <AuditStatusBadge status={status.audit_status} />
        </div>
        <p className="mt-4 font-heading text-lg font-semibold text-text-primary">
          {isError ? 'Audit failed' : 'Running audit…'}
        </p>
        <p className="mt-1 font-body text-sm text-text-secondary">
          {status.status_detail ?? 'Queued.'}
        </p>
        {typeof status.pages_crawled === 'number' && status.pages_crawled > 0 && (
          <p className="mt-2 font-body text-xs text-text-muted">
            {status.pages_crawled} pages crawled
          </p>
        )}
        {isError && status.error_message && (
          <p className="mt-4 rounded-lg bg-error/10 px-4 py-2 font-body text-sm text-error">
            {status.error_message}
          </p>
        )}
      </div>
    </div>
  )
}
