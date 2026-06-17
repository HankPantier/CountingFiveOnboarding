'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function MbpBackfillButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const router = useRouter()

  async function run() {
    if (!confirm('Derive values for the empty MBP fields from the existing profile + produced content? This runs an AI pass and queues suggestions for your review.')) return
    setBusy(true)
    setNote('')
    try {
      const res = await fetch(`/api/mbp/${sessionId}/backfill`, { method: 'POST' })
      const data = (await res.json()) as { created?: number; error?: string }
      if (!res.ok || data.error) {
        setNote(data.error ?? 'Failed')
        setBusy(false)
        return
      }
      setNote(
        data.created
          ? `${data.created} suggestion${data.created === 1 ? '' : 's'} queued`
          : 'Nothing new to derive'
      )
      router.refresh()
    } catch {
      setNote('Failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={busy}
        title="Derive empty fields from the positioning statement, niches, and service descriptions already in the profile"
        className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50"
      >
        {busy ? 'Deriving…' : 'Fill from what we know'}
      </button>
      {note && <span className="text-xs font-body text-text-muted">{note}</span>}
    </div>
  )
}
