'use client'
import { useState } from 'react'

export type ReviewArea = { city: string; county?: string; state?: string; primary?: boolean }
type Scope = 'local' | 'regional' | 'national'

type Props = {
  sessionId: string
  initialScope?: Scope
  initialAreas: ReviewArea[]
  onReviewed: () => void
}

const SCOPE_OPTIONS: Array<{ value: Scope; label: string; hint: string }> = [
  { value: 'local', label: 'Local', hint: 'One city / metro area' },
  { value: 'regional', label: 'Regional', hint: 'Several cities or counties' },
  { value: 'national', label: 'National', hint: 'No specific service area' },
]

export default function GeographyReviewCard({ sessionId, initialScope, initialAreas, onReviewed }: Props) {
  const [scope, setScope] = useState<Scope>(initialScope ?? (initialAreas.length ? 'local' : 'local'))
  const [areas, setAreas] = useState<ReviewArea[]>(
    () => (initialAreas.length ? initialAreas.map((a, i) => ({ ...a, primary: a.primary ?? i === 0 })) : [])
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const addArea = () => setAreas((prev) => [...prev, { city: '', primary: prev.length === 0 }])
  const removeArea = (idx: number) =>
    setAreas((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      if (next.length && !next.some((a) => a.primary)) next[0].primary = true
      return next
    })
  const updateArea = (idx: number, patch: Partial<ReviewArea>) =>
    setAreas((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)))
  const setPrimary = (idx: number) =>
    setAreas((prev) => prev.map((a, i) => ({ ...a, primary: i === idx })))

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const cleanAreas =
        scope === 'national' ? [] : areas.filter((a) => a.city.trim())
      const res = await fetch(`/api/sessions/${sessionId}/geo-reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, areas: cleanAreas }),
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
      <p className="text-sm font-heading font-semibold text-brand-navy">Service area review</p>
      <p className="text-text-secondary text-xs font-body mt-1">
        Where do you serve clients? This shapes your local pages and how we describe your reach.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {SCOPE_OPTIONS.map((opt) => {
          const active = scope === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setScope(opt.value)}
              className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${active ? 'border-brand-cyan bg-brand-cyan/10' : 'border-border-default bg-surface-page hover:border-brand-cyan/50'}`}
            >
              <span className={`text-sm font-heading font-semibold ${active ? 'text-brand-cyan-dark' : 'text-text-primary'}`}>
                {opt.label}
              </span>
              <span className="text-text-muted text-[11px] font-body mt-0.5">{opt.hint}</span>
            </button>
          )
        })}
      </div>

      {scope !== 'national' && (
        <div className="mt-4">
          <p className="text-xs font-heading font-semibold text-brand-navy">
            Cities / counties you serve or want to win
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {areas.map((a, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={a.city}
                  onChange={(e) => updateArea(idx, { city: e.target.value })}
                  placeholder="City"
                  className="flex-1 min-w-0 rounded-lg border border-border-default bg-surface-page px-3 py-1.5 text-sm font-body text-text-primary focus:border-brand-cyan focus:outline-none"
                />
                <input
                  type="text"
                  value={a.state ?? ''}
                  onChange={(e) => updateArea(idx, { state: e.target.value })}
                  placeholder="State"
                  className="w-16 rounded-lg border border-border-default bg-surface-page px-2 py-1.5 text-sm font-body text-text-primary focus:border-brand-cyan focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setPrimary(idx)}
                  className={`shrink-0 rounded-pill border px-3 py-1 text-[11px] font-heading font-semibold transition-colors ${a.primary ? 'border-brand-cyan bg-brand-cyan text-text-inverse' : 'border-border-default text-text-secondary hover:text-brand-cyan'}`}
                  title="Mark as your primary market"
                >
                  {a.primary ? 'Primary' : 'Set primary'}
                </button>
                <button
                  type="button"
                  onClick={() => removeArea(idx)}
                  className="shrink-0 text-text-muted hover:text-error"
                  aria-label="Remove area"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addArea}
            className="mt-2 rounded-pill border border-border-default px-4 py-1.5 text-xs font-heading font-semibold text-text-secondary transition-colors hover:text-brand-cyan"
          >
            + Add a city
          </button>
        </div>
      )}

      {error && <p className="text-error text-xs font-body mt-3">{error}</p>}

      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all duration-150 hover:bg-brand-cyan-dark active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Save service area'}
        </button>
      </div>
    </div>
  )
}
