'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MbpSuggestion } from '@/types/mbp'

function SuggestionCard({
  sessionId,
  suggestion,
  isAdmin,
}: {
  sessionId: string
  suggestion: MbpSuggestion
  isAdmin: boolean
}) {
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function act(action: 'approve' | 'dismiss') {
    setBusy(action)
    setError('')
    try {
      const res = await fetch(`/api/mbp/${sessionId}/suggestions/${suggestion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed')
        setBusy(null)
        return
      }
      router.refresh()
    } catch {
      setError('Failed. Please try again.')
      setBusy(null)
    }
  }

  return (
    <div className="border border-border-default rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-body text-text-primary">{suggestion.summary}</p>
        <span className="text-xs font-body text-text-muted whitespace-nowrap">{suggestion.origin.replace('_', ' ')}</span>
      </div>
      {suggestion.source_ref && (
        <p className="text-xs font-body text-text-muted">from: {suggestion.source_ref}</p>
      )}
      <div className="space-y-1.5">
        {Object.entries(suggestion.changes).map(([fieldPath, change]) => (
          <div key={fieldPath} className="text-xs font-body bg-surface-subtle rounded px-2 py-1.5">
            <p className="font-heading font-semibold text-text-secondary">{fieldPath}</p>
            {change.currentValue !== undefined && change.currentValue !== null && change.currentValue !== '' && (
              <p className="text-text-muted line-through break-words">{String(change.currentValue)}</p>
            )}
            <p className="text-text-primary break-words">{String(change.proposedValue)}</p>
            <p className="text-text-muted italic mt-0.5">{change.rationale}</p>
          </div>
        ))}
      </div>
      {error && <p className="text-xs font-body text-error">{error}</p>}
      {isAdmin && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => act('approve')}
            disabled={busy !== null}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-4 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50"
          >
            {busy === 'approve' ? 'Applying…' : 'Approve'}
          </button>
          <button
            onClick={() => act('dismiss')}
            disabled={busy !== null}
            className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-4 py-1.5 rounded-pill transition-all hover:bg-surface-subtle disabled:opacity-50"
          >
            {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function MbpSuggestions({
  sessionId,
  suggestions,
  isAdmin,
}: {
  sessionId: string
  suggestions: MbpSuggestion[]
  isAdmin: boolean
}) {
  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-surface-subtle flex items-center justify-between">
        <span className="text-sm font-heading font-semibold text-text-primary">Suggested updates</span>
        <span className="text-xs font-body text-text-muted">{suggestions.length} pending</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {suggestions.length === 0 ? (
          <p className="text-sm font-body text-text-muted italic">
            No pending suggestions. Content changes that affect the profile will appear here.
          </p>
        ) : (
          suggestions.map(s => (
            <SuggestionCard key={s.id} sessionId={sessionId} suggestion={s} isAdmin={isAdmin} />
          ))
        )}
      </div>
    </div>
  )
}
