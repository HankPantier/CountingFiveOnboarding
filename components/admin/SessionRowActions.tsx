'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SessionRowActions({
  sessionId,
  sessionStatus,
}: {
  sessionId: string
  sessionStatus?: string
}) {
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const router = useRouter()
  const isArchived = sessionStatus === 'archived'

  async function handleDelete() {
    if (!confirm('Delete this session and all associated files? This cannot be undone.')) return
    setDeleting(true)
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      router.refresh()
    } catch {
      setDeleting(false)
    }
  }

  async function handleArchiveToggle() {
    setArchiving(true)
    try {
      await fetch(`/api/sessions/${sessionId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !isArchived }),
      })
      router.refresh()
    } finally {
      setArchiving(false)
    }
  }

  const showOnboarding = sessionStatus === 'pending' || sessionStatus === 'in_progress'

  return (
    <div className="flex items-center justify-end gap-4">
      {showOnboarding && (
        <Link
          href={`/admin/sessions/${sessionId}/onboarding`}
          className="text-brand-cyan hover:text-brand-navy font-heading font-semibold text-xs transition-colors"
          title="Run the onboarding call: capture notes, then the agent Q&A"
        >
          Onboarding →
        </Link>
      )}
      <Link
        href={`/admin/sessions/${sessionId}`}
        className="text-text-secondary hover:text-brand-navy font-heading font-semibold text-xs transition-colors"
      >
        Session
      </Link>
      <Link
        href={`/admin/sessions/${sessionId}/mbp`}
        className="text-text-secondary hover:text-brand-navy font-heading font-semibold text-xs transition-colors"
        title="View / edit the Master Business Profile"
        aria-label="View Master Business Profile"
      >
        MBP
      </Link>
      <button
        onClick={handleArchiveToggle}
        disabled={archiving}
        title={isArchived ? 'Restore session to the active list' : 'Archive session (keeps all data, hides from the active list)'}
        className="text-text-muted hover:text-brand-navy font-heading font-semibold text-xs transition-colors disabled:opacity-40"
      >
        {archiving ? '…' : isArchived ? 'Restore' : 'Archive'}
      </button>
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete session"
        className="text-text-muted hover:text-error text-xs transition-colors disabled:opacity-40"
      >
        {deleting ? '…' : '×'}
      </button>
    </div>
  )
}
