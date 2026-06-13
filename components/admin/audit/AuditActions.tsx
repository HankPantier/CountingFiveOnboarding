'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ghostButton =
  'rounded-pill border border-border-strong px-4 py-2 font-heading text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50'

export function AuditActions({ auditId, status }: { auditId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const running = ['crawling', 'analyzing', 'scoring', 'rendering'].includes(status)

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
      {status === 'complete' && (
        <a
          href={`/api/audits/${auditId}/export`}
          className="rounded-pill bg-brand-cyan px-4 py-2 font-heading text-sm font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark"
        >
          Export HTML
        </a>
      )}
      <button onClick={rerun} disabled={busy || running} className={ghostButton}>
        {running ? 'Running…' : 'Re-run'}
      </button>
      <button onClick={remove} disabled={busy} className={`${ghostButton} hover:text-error`}>
        Delete
      </button>
    </div>
  )
}
