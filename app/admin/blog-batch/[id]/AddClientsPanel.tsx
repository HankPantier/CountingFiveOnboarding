'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ClientOption } from '../new/NewBatchFlow'

// Fan an existing batch's locked idea out to more clients. `clients` are the
// eligible clients not already in the batch (computed server-side).
export default function AddClientsPanel({
  batchId,
  clients,
  onAdded,
}: {
  batchId: string
  clients: ClientOption[]
  onAdded: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function add() {
    if (selected.size === 0) return
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/blog-batches/${batchId}/add-clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: [...selected] }),
      })
      const data = (await res.json()) as { added?: number; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Could not add clients')
        return
      }
      setSelected(new Set())
      setOpen(false)
      onAdded()
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  if (clients.length === 0 && !open) {
    return null
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 rounded-pill border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 transition-all hover:border-brand-cyan hover:text-brand-navy"
      >
        + Add clients
      </button>
    )
  }

  return (
    <div className="mb-6 bg-surface-card border border-border-default rounded-xl p-5 shadow-subtle">
      <div className="flex items-center justify-between mb-4">
        <label className="text-xs font-heading font-semibold text-brand-navy uppercase tracking-wide">
          Add clients ({selected.size} selected)
        </label>
        <div className="flex gap-3 text-xs font-body">
          <button
            type="button"
            onClick={() => setSelected(new Set(clients.map((c) => c.id)))}
            className="text-brand-cyan hover:underline"
          >
            Select all
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-text-muted hover:underline">
            Clear
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card mb-4">{error}</p>}

      {clients.length === 0 ? (
        <p className="text-sm text-text-muted font-body py-6 text-center">
          No other eligible clients. A client must have a published, repo-linked site and not already be in this batch.
        </p>
      ) : (
        <div className="border border-border-default rounded-card max-h-72 overflow-y-auto divide-y divide-border-default mb-4">
          {clients.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-subtle">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="accent-brand-cyan"
              />
              <span className="text-sm font-body text-text-primary truncate">{c.firmName ?? c.websiteUrl}</span>
              {c.firmName && <span className="text-xs text-text-muted truncate">{c.websiteUrl}</span>}
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError('')
          }}
          className="rounded-pill border border-border-default text-text-secondary font-heading font-semibold text-xs px-4 py-2 transition-all hover:bg-surface-subtle"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={add}
          disabled={submitting || selected.size === 0}
          className="flex-1 rounded-pill bg-brand-cyan text-text-inverse font-heading font-semibold text-xs py-2 shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Adding…' : `Add & generate for ${selected.size} client${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
