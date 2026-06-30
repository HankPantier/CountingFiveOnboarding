'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type State = 'idle' | 'working' | 'error'

export default function RegenerateMbpButton({
  sessionId,
  label = 'Regenerate MBP',
}: {
  sessionId: string
  label?: string
}) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleClick() {
    setState('working')
    setError('')
    try {
      const res = await fetch('/api/pdf/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`)
        setState('error')
        return
      }
      setState('idle')
      router.refresh()
    } catch {
      setError('Request failed. Please try again.')
      setState('error')
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={state === 'working'}
        className="inline-flex items-center gap-2 text-sm font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors disabled:opacity-50"
      >
        {state === 'working' ? 'Generating…' : label}
      </button>
      {error && <p className="text-error text-xs font-body mt-1">{error}</p>}
    </div>
  )
}
