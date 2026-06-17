'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShareLinkButton } from './ShareLinkButton'
import AuditChatModal from './AuditChatModal'

const ghostButton =
  'rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50'
const dangerButton =
  'rounded-pill border border-error/50 px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-error transition-colors hover:bg-error hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton =
  'rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50'

export function AuditActions({
  auditId,
  status,
  approved,
  sessionId,
  shareToken,
  chatMessages,
}: {
  auditId: string
  status: string
  approved: boolean
  sessionId: string | null
  shareToken: string | null
  chatMessages: { role: string; content: string }[]
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
    <div className="flex shrink-0 items-center gap-1.5">
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

      {complete && <AuditChatModal auditId={auditId} initialMessages={chatMessages} />}
      {complete && <ShareLinkButton auditId={auditId} initialToken={shareToken} />}
      <button onClick={rerun} disabled={busy || running} className={ghostButton}>
        {running ? 'Running…' : 'Re-run'}
      </button>
      <button onClick={remove} disabled={busy} className={`ml-1 ${dangerButton}`}>
        Delete
      </button>
    </div>
  )
}
