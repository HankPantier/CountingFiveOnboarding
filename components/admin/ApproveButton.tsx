'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ApproveState = 'idle' | 'generating' | 'approving' | 'done' | 'error'

const STATE_LABELS: Record<ApproveState, string> = {
  idle:       'Approve Session',
  generating: 'Generating PDF…',
  approving:  'Finalizing…',
  done:       'Approved',
  error:      'Retry Approval',
}

export default function ApproveButton({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<ApproveState>('idle')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleApprove() {
    if (!confirm('Approve this session? This will generate the PDF and mark the session as approved.')) return
    setState('generating')
    setError('')

    try {
      setState('approving')
      const res = await fetch(`/api/sessions/${sessionId}/approve`, { method: 'POST' })
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

  const busy = state === 'generating' || state === 'approving'
  const done = state === 'done'

  return (
    <div className="mt-6">
      {error && (
        <p className="text-sm font-body text-red-700 mb-3">{error}</p>
      )}
      {busy && (
        <div className="mb-3 flex items-center gap-2 text-sm font-body text-text-secondary">
          <span className="animate-pulse">●</span>
          {state === 'generating' ? 'Generating PDF and markdown summary…' : 'Saving approval…'}
        </div>
      )}
      <button
        onClick={handleApprove}
        disabled={busy || done}
        className={[
          'w-full font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all',
          done
            ? 'bg-green-600 text-white cursor-default'
            : 'bg-brand-navy text-text-inverse hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {STATE_LABELS[state]}
      </button>
    </div>
  )
}
