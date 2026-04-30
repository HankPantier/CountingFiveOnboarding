'use client'
import { useState } from 'react'

export default function SendReminderButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSend() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}/remind`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (data.error) {
        setError(data.error)
        return
      }
      setSent(true)
      setTimeout(() => setSent(false), 4000)
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {error && <p className="text-sm font-body text-red-700 mb-2">{error}</p>}
      <button
        onClick={handleSend}
        disabled={loading || sent}
        className="w-full border border-border-default text-text-secondary font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Sending…' : sent ? 'Reminder sent' : 'Send Reminder'}
      </button>
    </div>
  )
}
