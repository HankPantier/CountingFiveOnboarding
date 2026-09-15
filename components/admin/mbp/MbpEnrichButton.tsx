'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Proactive pre-generation enrichment: deepen the content-critical MBP fields
// (niche depth, positioning, voice) from the site audit + call notes before the
// first content run, queuing suggestions for review. Sibling to MbpBackfillButton;
// enrichment grounds on audit + notes and reaches the deep niche fields.
export default function MbpEnrichButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const router = useRouter()

  async function run() {
    if (!confirm('Deepen the empty content fields (niche detail, positioning, voice) from the audit + call notes before content generation? This runs an AI pass. High-confidence fills grounded in both the audit and the call notes are applied to empty fields automatically (and logged in the suggestion history); everything else is queued for your review.')) return
    setBusy(true)
    setNote('')
    try {
      const res = await fetch(`/api/mbp/${sessionId}/enrich`, { method: 'POST' })
      const data = (await res.json()) as { created?: number; applied?: number; error?: string }
      if (!res.ok || data.error) {
        setNote(data.error ?? 'Failed')
        setBusy(false)
        return
      }
      const created = data.created ?? 0
      const applied = data.applied ?? 0
      const parts: string[] = []
      if (applied) parts.push(`${applied} high-confidence field${applied === 1 ? '' : 's'} auto-applied`)
      if (created) parts.push(`${created} suggestion${created === 1 ? '' : 's'} queued`)
      setNote(parts.length ? parts.join(', ') : 'Nothing new to enrich')
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
        title="Deepen niche detail, positioning, and voice from the audit + call notes, before content generation"
        className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50"
      >
        {busy ? 'Enriching…' : 'Enrich for content'}
      </button>
      {note && <span className="text-xs font-body text-text-muted">{note}</span>}
    </div>
  )
}
