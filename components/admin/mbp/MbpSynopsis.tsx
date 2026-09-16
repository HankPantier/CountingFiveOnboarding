'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export default function MbpSynopsis({
  sessionId,
  synopsis,
  isAdmin,
}: {
  sessionId: string
  synopsis: { text: string; generatedAt: string } | null
  isAdmin: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function run() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/mbp/${sessionId}/synopsis`, { method: 'POST' })
      const data = (await res.json()) as { synopsis?: string; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed to generate.')
        return
      }
      router.refresh()
    } catch {
      setError('Failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-border-default rounded-xl overflow-hidden bg-surface-card">
      <div className="px-4 py-2.5 bg-surface-subtle flex items-center justify-between gap-3">
        <span className="text-sm font-heading font-semibold text-text-primary">Firm synopsis</span>
        <div className="flex items-center gap-2">
          {synopsis && (
            <span className="text-xs font-body text-text-muted">generated {relativeTime(synopsis.generatedAt)}</span>
          )}
          {isAdmin && (
            <button
              onClick={run}
              disabled={busy}
              className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3 py-1 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50"
            >
              {busy ? 'Generating…' : synopsis ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        {error && <p className="text-xs font-body text-error mb-2">{error}</p>}
        {synopsis ? (
          <p className="text-sm font-body text-text-primary whitespace-pre-wrap leading-relaxed">{synopsis.text}</p>
        ) : (
          <p className="text-sm font-body text-text-muted italic">
            {isAdmin
              ? 'No synopsis yet — click Generate to summarize who this firm is and how they sound.'
              : 'No synopsis generated yet.'}
          </p>
        )}
      </div>
    </div>
  )
}
