'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SessionRowActions({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  function copyLink() {
    const url = `${window.location.origin}/session/${sessionId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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

  return (
    <div className="flex items-center justify-end gap-4">
      <button
        onClick={copyLink}
        className={`text-xs font-heading font-semibold transition-colors ${copied ? 'text-green-600' : 'text-text-muted hover:text-brand-cyan'}`}
      >
        {copied ? 'Copied!' : 'Copy link'}
      </button>
      <Link
        href={`/admin/sessions/${sessionId}`}
        className="text-brand-cyan hover:text-brand-navy font-heading font-semibold text-xs transition-colors"
      >
        View
      </Link>
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete session"
        className="text-text-muted hover:text-red-500 text-xs transition-colors disabled:opacity-40"
      >
        {deleting ? '…' : '×'}
      </button>
    </div>
  )
}
