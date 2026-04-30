'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<'idle' | 'deleting' | 'error'>('idle')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleDelete() {
    if (!confirm('Permanently delete this session and all associated files, messages, and uploads? This cannot be undone.')) return
    setState('deleting')
    setError('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (data.error) {
        setError(data.error)
        setState('error')
        return
      }
      router.push('/admin/dashboard')
    } catch {
      setError('Delete failed. Please try again.')
      setState('error')
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-border-default">
      {error && <p className="text-sm font-body text-red-700 mb-3">{error}</p>}
      <button
        onClick={handleDelete}
        disabled={state === 'deleting'}
        className="w-full border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-400 font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === 'deleting' ? 'Deleting…' : 'Delete Session'}
      </button>
    </div>
  )
}
