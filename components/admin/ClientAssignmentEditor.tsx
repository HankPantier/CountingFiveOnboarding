'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionOption } from '@/app/admin/settings/users/page'
import type { UserAssignmentsResponse } from '@/types/users'

export default function ClientAssignmentEditor({
  userId,
  sessions,
  onClose,
}: {
  userId: string
  sessions: SessionOption[]
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    let active = true
    fetch(`/api/admin/users/${userId}/clients`)
      .then(r => r.json() as Promise<UserAssignmentsResponse & { error?: string }>)
      .then(data => {
        if (!active) return
        if (data.assigned) setSelected(new Set(data.assigned.map(a => a.session_id)))
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('Failed to load assignments')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/users/${userId}/clients`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: [...selected] }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed to save')
        setSaving(false)
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
      <div className="w-full max-w-md bg-surface-card rounded-card p-6 shadow-subtle max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-heading font-bold text-brand-navy mb-4">
          Client access ({selected.size} selected)
        </h2>

        {error && (
          <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card mb-3">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-text-muted font-body py-6 text-center">Loading…</p>
        ) : (
          <div className="border border-border-default rounded-card max-h-64 overflow-y-auto divide-y divide-border-default mb-4">
            {sessions.length === 0 && (
              <p className="text-sm text-text-muted font-body p-3">No clients available.</p>
            )}
            {sessions.map(s => (
              <label
                key={s.id}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-subtle"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-brand-cyan"
                />
                <span className="text-sm font-body text-text-primary truncate">{s.website_url}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-border-default text-text-secondary font-heading font-semibold text-sm py-3 rounded-pill transition-all hover:bg-surface-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="flex-1 bg-brand-cyan text-text-inverse font-heading font-semibold text-sm py-3 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save access'}
          </button>
        </div>
      </div>
    </div>
  )
}
