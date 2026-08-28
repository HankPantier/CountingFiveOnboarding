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
  const [warning, setWarning] = useState('')
  const router = useRouter()

  async function handleApprove() {
    if (!confirm('Approve this session? This will generate the MBP and mark the session as approved.')) return
    setState('generating')
    setError('')
    setWarning('')

    try {
      setState('approving')
      const post = (override: boolean) =>
        fetch(`/api/sessions/${sessionId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ override }),
        })

      let res = await post(false)
      let data = await res.json() as { error?: string; deliverableError?: string | null; incompleteFields?: string[] }

      // 422 = unresolved Tier-1 gaps. Confirm with the admin, then re-submit
      // with override so a deliberate approval of a thin profile can proceed.
      if (res.status === 422 && data.incompleteFields?.length) {
        const list = data.incompleteFields.map((f) => `• ${f}`).join('\n')
        if (!confirm(`This profile is missing required (Tier 1) fields:\n\n${list}\n\nApprove anyway?`)) {
          setState('idle')
          return
        }
        res = await post(true)
        data = await res.json() as { error?: string; deliverableError?: string | null; incompleteFields?: string[] }
      }

      if (data.error) {
        setError(data.error)
        setState('error')
        return
      }
      // Approval succeeded but the MBP couldn't be generated — surface it; the
      // detail page offers a "Generate MBP" retry once it refreshes.
      if (data.deliverableError) {
        setWarning(`Approved, but the MBP wasn't generated (${data.deliverableError}). Use "Generate MBP" to retry.`)
      }
      setState('done')
      setTimeout(() => router.refresh(), data.deliverableError ? 3000 : 800)
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
        <p className="text-sm font-body text-error mb-3">{error}</p>
      )}
      {warning && (
        <p className="text-sm font-body text-warning-strong mb-3">{warning}</p>
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
