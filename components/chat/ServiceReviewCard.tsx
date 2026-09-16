'use client'
import { useState } from 'react'

export type ReviewService = { name: string; note?: string }

type Props = {
  sessionId: string
  services: ReviewService[]
  onReviewed: () => void
}

export default function ServiceReviewCard({ sessionId, services, onReviewed }: Props) {
  // Default every service to "keep" — dropping is the deliberate action.
  const [decisions, setDecisions] = useState<Record<string, 'keep' | 'drop'>>(
    () => Object.fromEntries(services.map((s) => [s.name, 'keep' as const]))
  )
  const [added, setAdded] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const setDecision = (name: string, value: 'keep' | 'drop') =>
    setDecisions((prev) => ({ ...prev, [name]: value }))

  const addDraft = () => {
    const name = draft.trim()
    if (!name) return
    const existing = new Set([...services.map((s) => s.name.toLowerCase()), ...added.map((a) => a.toLowerCase())])
    if (!existing.has(name.toLowerCase())) setAdded((prev) => [...prev, name])
    setDraft('')
  }

  const removeAdded = (name: string) => setAdded((prev) => prev.filter((a) => a !== name))

  const droppedCount = Object.values(decisions).filter((d) => d === 'drop').length

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const keep = services.filter((s) => decisions[s.name] !== 'drop').map((s) => s.name)
      const drop = services.filter((s) => decisions[s.name] === 'drop').map((s) => s.name)
      const res = await fetch(`/api/sessions/${sessionId}/services-reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep, drop, add: added }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      onReviewed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review')
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-border-default rounded-xl bg-surface-card p-5 shadow-subtle">
      <p className="text-sm font-heading font-semibold text-brand-navy">Services review</p>
      <p className="text-text-secondary text-xs font-body mt-1">
        These are the services we found for your firm. Keep the ones you offer and drop any you
        don&apos;t — dropped services won&apos;t get pages or content. Add anything we missed.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {services.map((s) => {
          const dropped = decisions[s.name] === 'drop'
          return (
            <div
              key={s.name}
              className="flex items-start justify-between gap-3 rounded-lg border border-border-default bg-surface-page px-3 py-2.5"
            >
              <div className="min-w-0">
                <span className={`text-sm font-heading font-semibold ${dropped ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                  {s.name}
                </span>
                {s.note && <p className="text-text-secondary text-xs font-body mt-0.5">{s.note}</p>}
              </div>
              <div className="flex shrink-0 rounded-pill border border-border-default overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDecision(s.name, 'keep')}
                  className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${!dropped ? 'bg-brand-cyan text-text-inverse' : 'bg-surface-card text-text-secondary hover:text-brand-cyan'}`}
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => setDecision(s.name, 'drop')}
                  className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${dropped ? 'bg-error/10 text-error' : 'bg-surface-card text-text-secondary hover:text-error'}`}
                >
                  Drop
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <p className="text-xs font-heading font-semibold text-brand-navy">Add a service we missed</p>
        {added.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {added.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-pill border border-brand-cyan/30 bg-brand-cyan/10 px-2.5 py-0.5 text-xs font-body text-brand-cyan-dark"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeAdded(name)}
                  className="text-brand-cyan-dark hover:text-error"
                  aria-label={`Remove ${name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addDraft()
              }
            }}
            placeholder="e.g. Fractional CFO"
            className="flex-1 rounded-lg border border-border-default bg-surface-page px-3 py-1.5 text-sm font-body text-text-primary focus:border-brand-cyan focus:outline-none"
          />
          <button
            type="button"
            onClick={addDraft}
            className="rounded-pill border border-border-default px-4 py-1.5 text-xs font-heading font-semibold text-text-secondary transition-colors hover:text-brand-cyan"
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="text-error text-xs font-body mt-3">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-text-muted text-xs font-body">
          {droppedCount > 0 ? `${droppedCount} to drop` : 'Keeping all'}
          {added.length > 0 ? ` · ${added.length} to add` : ''}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all duration-150 hover:bg-brand-cyan-dark active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Save services review'}
        </button>
      </div>
    </div>
  )
}
