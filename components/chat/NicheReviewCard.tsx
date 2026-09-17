'use client'
import { useState } from 'react'

export type ReviewNiche = { name: string; signal?: 'weak' | 'moderate' | 'strong'; note?: string }

type Props = {
  sessionId: string
  niches: ReviewNiche[]
  highOpportunityNiches: string[]
  onReviewed: (result: { drop: string[] }) => void
}

const SIGNAL_STYLES: Record<string, string> = {
  strong: 'bg-brand-cyan/15 text-brand-cyan-dark border-brand-cyan/30',
  moderate: 'bg-surface-subtle text-text-secondary border-border-default',
  weak: 'bg-warning/10 text-warning border-warning/40',
}

function SignalBadge({ signal }: { signal?: ReviewNiche['signal'] }) {
  const label = signal ? `${signal} signal` : 'unrated'
  const cls = signal ? SIGNAL_STYLES[signal] : 'bg-surface-subtle text-text-muted border-border-default'
  return (
    <span className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[11px] font-heading font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

export default function NicheReviewCard({ sessionId, niches, highOpportunityNiches, onReviewed }: Props) {
  // Default every detected niche to "keep" — dropping is the deliberate action.
  const [decisions, setDecisions] = useState<Record<string, 'keep' | 'drop'>>(
    () => Object.fromEntries(niches.map((n) => [n.name, 'keep' as const]))
  )
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const setDecision = (name: string, value: 'keep' | 'drop') =>
    setDecisions((prev) => ({ ...prev, [name]: value }))

  const toggleAdd = (name: string) =>
    setAdded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const droppedCount = Object.values(decisions).filter((d) => d === 'drop').length

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const keep = niches.filter((n) => decisions[n.name] !== 'drop').map((n) => n.name)
      const drop = niches.filter((n) => decisions[n.name] === 'drop').map((n) => n.name)
      const add = Array.from(added)
      const res = await fetch(`/api/sessions/${sessionId}/niches-reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep, drop, add }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      onReviewed({ drop })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review')
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-border-default rounded-xl bg-surface-card p-5 shadow-subtle">
      <p className="text-sm font-heading font-semibold text-brand-navy">Industry review</p>
      <p className="text-text-secondary text-xs font-body mt-1">
        We found these industries on your site. Keep the ones you want to pursue and drop any you
        don&apos;t — dropped industries won&apos;t get pages or content. Weak signals are worth a
        closer look.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {niches.map((n) => {
          const dropped = decisions[n.name] === 'drop'
          return (
            <div
              key={n.name}
              className="flex items-start justify-between gap-3 rounded-lg border border-border-default bg-surface-page px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-heading font-semibold ${dropped ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                    {n.name}
                  </span>
                  <SignalBadge signal={n.signal} />
                </div>
                {n.note && <p className="text-text-secondary text-xs font-body mt-0.5">{n.note}</p>}
              </div>
              <div className="flex shrink-0 rounded-pill border border-border-default overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDecision(n.name, 'keep')}
                  className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${!dropped ? 'bg-brand-cyan text-text-inverse' : 'bg-surface-card text-text-secondary hover:text-brand-cyan'}`}
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => setDecision(n.name, 'drop')}
                  className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${dropped ? 'bg-error/10 text-error' : 'bg-surface-card text-text-secondary hover:text-error'}`}
                >
                  Drop
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {highOpportunityNiches.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-heading font-semibold text-brand-navy">
            Add a high-opportunity industry
          </p>
          <p className="text-text-muted text-xs font-body mt-0.5">
            Our analyst flagged these as untapped. Check any you want us to build for.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {highOpportunityNiches.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm font-body text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={added.has(name)}
                  onChange={() => toggleAdd(name)}
                  className="accent-brand-cyan"
                />
                {name}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-error text-xs font-body mt-3">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-text-muted text-xs font-body">
          {droppedCount > 0 ? `${droppedCount} to drop` : 'Keeping all'}
          {added.size > 0 ? ` · ${added.size} to add` : ''}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all duration-150 hover:bg-brand-cyan-dark active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Save industry review'}
        </button>
      </div>
    </div>
  )
}
