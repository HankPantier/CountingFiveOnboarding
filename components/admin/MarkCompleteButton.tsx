'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type CompleteState = 'idle' | 'saving' | 'done' | 'error'

const STATE_LABELS: Record<CompleteState, string> = {
  idle:  'Mark Complete',
  saving: 'Marking complete…',
  done:  'Completed',
  error: 'Retry',
}

export default function MarkCompleteButton({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<CompleteState>('idle')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleComplete() {
    if (!confirm('Mark this session complete? This ends onboarding for the client and lets you approve it for content generation.')) return
    setState('saving')
    setError('')

    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (data.error) {
        setError(data.error)
        setState('error')
        return
      }
      setState('done')
      setTimeout(() => router.refresh(), 800)
    } catch {
      setError('Request failed. Please try again.')
      setState('error')
    }
  }

  const busy = state === 'saving'
  const done = state === 'done'

  return (
    <div className="mt-4">
      {error && (
        <p className="text-sm font-body text-error mb-3">{error}</p>
      )}
      <button
        onClick={handleComplete}
        disabled={busy || done}
        className={[
          'w-full font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all',
          done
            ? 'bg-success text-white cursor-default'
            : 'bg-brand-navy text-text-inverse hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {STATE_LABELS[state]}
      </button>
    </div>
  )
}
