'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShareLinkButton } from './ShareLinkButton'
import AuditChatModal from './AuditChatModal'

const ghostButton =
  'rounded-pill border border-border-default px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-text-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50'
const dangerButton =
  'rounded-pill border border-error/50 px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton =
  'rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-text-inverse shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow disabled:cursor-not-allowed disabled:opacity-50'

export function AuditActions({
  auditId,
  status,
  approved,
  sessionId,
  shareToken,
  chatMessages,
  isAdmin,
}: {
  auditId: string
  status: string
  approved: boolean
  sessionId: string | null
  shareToken: string | null
  chatMessages: { role: string; content: string }[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const running = ['crawling', 'analyzing', 'researching', 'scoring', 'rendering'].includes(status)
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

  // Adds the latest analysis (social & local presence) to an existing audit
  // without a full re-crawl — scores and page analysis are preserved.
  const refresh = async () => {
    setBusy(true)
    try {
      await fetch(`/api/audits/${auditId}/refresh`, { method: 'POST' })
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
      {/* The approve → start-session flow creates an onboarding session, which
          is admin-only. Auditors get the report tools below but not this block. */}
      {isAdmin && (sessionId ? (
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
      ) : null)}

      {complete && <AuditChatModal auditId={auditId} initialMessages={chatMessages} />}
      {complete && <ShareLinkButton auditId={auditId} initialToken={shareToken} />}
      {complete && (
        <button
          onClick={refresh}
          disabled={busy}
          className={ghostButton}
          title="Add the latest analysis (social & local presence) without re-crawling"
        >
          Refresh
        </button>
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
