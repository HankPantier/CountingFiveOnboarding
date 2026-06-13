'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const ghostButton =
  'rounded-pill border-2 border-brand-navy px-4 py-2 font-heading text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50'
const dangerButton =
  'rounded-pill border-2 border-error/50 px-4 py-2 font-heading text-sm font-semibold text-error transition-colors hover:bg-error hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton =
  'rounded-pill bg-brand-cyan px-4 py-2 font-heading text-sm font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50'

export function AuditActions({
  auditId,
  status,
  approved,
  sessionId,
}: {
  auditId: string
  status: string
  approved: boolean
  sessionId: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const running = ['crawling', 'analyzing', 'scoring', 'rendering'].includes(status)
  const complete = status === 'complete'

  const approve = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/audits/${auditId}/approve`, { method: 'POST' })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const rerun = async () => {
    setBusy(true)
    try {
      await fetch(`/api/audits/${auditId}/run`, { method: 'POST' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Delete this audit run? This cannot be undone.')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/audits/${auditId}`, { method: 'DELETE' })
      if (res.ok) router.push('/admin/audits')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {sessionId ? (
        <Link href={`/admin/sessions/${sessionId}`} className={primaryButton}>
          View session →
        </Link>
      ) : complete && !approved ? (
        <button onClick={approve} disabled={busy} className={primaryButton}>
          {busy ? 'Approving…' : 'Approve'}
        </button>
      ) : complete && approved ? (
        <Link href={`/admin/audits/${auditId}/start-session`} className={primaryButton}>
          Start session →
        </Link>
      ) : null}

      {complete && (
        <a href={`/api/audits/${auditId}/export`} className={ghostButton}>
          Export HTML
        </a>
      )}
      <button onClick={rerun} disabled={busy || running} className={ghostButton}>
        {running ? 'Running…' : 'Re-run'}
      </button>
      <button onClick={remove} disabled={busy} className={`ml-1 ${dangerButton}`}>
        Delete
      </button>
    </div>
  )
}
