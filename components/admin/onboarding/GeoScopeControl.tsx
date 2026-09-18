'use client'
import { useEffect, useState } from 'react'

export type ReviewArea = { city: string; county?: string; state?: string; primary?: boolean }
export type GeoScope = 'local' | 'regional' | 'national'
export type GeoPayload = { scope: GeoScope; areas: ReviewArea[] }

type AreaRow = ReviewArea & { keep: boolean }

const SCOPES: { value: GeoScope; label: string; hint: string }[] = [
  { value: 'local', label: 'Local', hint: 'One metro / a few cities' },
  { value: 'regional', label: 'Regional', hint: 'A wider multi-city region' },
  { value: 'national', label: 'National', hint: 'No geo landing pages' },
]

// Geographic scope + confirmed service areas. Emits { scope, areas } (the exact
// GeoReviewInput shape) up to AuditReview. National clears the area list.
export default function GeoScopeControl({
  initialScope,
  initialAreas,
  onChange,
  suggestedScope,
  suggestedPrimaryArea,
  suggestionRationale,
  suggestionConfidence,
}: {
  initialScope?: GeoScope
  initialAreas: ReviewArea[]
  onChange: (payload: GeoPayload) => void
  suggestedScope?: GeoScope
  suggestedPrimaryArea?: string
  suggestionRationale?: string
  suggestionConfidence?: 'high' | 'medium' | 'low'
}) {
  const [scope, setScope] = useState<GeoScope>(initialScope ?? (initialAreas.length ? 'local' : 'national'))
  const [areas, setAreas] = useState<AreaRow[]>(
    () => initialAreas.map((a, i) => ({ ...a, keep: true, primary: a.primary ?? i === 0 })),
  )
  const [city, setCity] = useState('')
  const [state, setState] = useState('')

  useEffect(() => {
    if (scope === 'national') {
      onChange({ scope, areas: [] })
      return
    }
    const kept = areas.filter((a) => a.keep && a.city.trim())
    onChange({
      scope,
      areas: kept.map((a) => ({
        city: a.city,
        ...(a.county ? { county: a.county } : {}),
        ...(a.state ? { state: a.state } : {}),
        ...(a.primary ? { primary: true } : {}),
      })),
    })
  }, [scope, areas, onChange])

  const addArea = () => {
    const c = city.trim()
    if (!c) return
    setAreas((prev) => [...prev, { city: c, ...(state.trim() ? { state: state.trim() } : {}), keep: true, primary: prev.every((a) => !a.primary || !a.keep) }])
    setCity('')
    setState('')
  }

  const setPrimary = (idx: number) =>
    setAreas((prev) => prev.map((a, i) => ({ ...a, primary: i === idx })))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setScope(s.value)}
            className={`rounded-pill border px-3.5 py-1.5 text-xs font-heading font-semibold transition-colors ${scope === s.value ? 'bg-brand-navy text-text-inverse border-brand-navy' : 'bg-surface-card text-text-secondary border-border-default hover:text-brand-navy'}`}
          >
            {s.label}
            <span className="ml-1 font-body font-normal opacity-70">· {s.hint}</span>
          </button>
        ))}
      </div>

      {suggestedScope && suggestionRationale && (
        <p className="text-xs font-body text-text-muted flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-brand-cyan-dark font-heading font-semibold">✦ AI</span>
          {scope === suggestedScope ? (
            <span className="text-text-secondary font-heading font-semibold">suggests {suggestedScope}:</span>
          ) : (
            <span className="text-text-secondary">suggested <span className="font-heading font-semibold">{suggestedScope}</span> (you chose {scope}):</span>
          )}
          <span>{suggestionRationale}</span>
          {suggestedPrimaryArea && <span className="text-text-secondary">Primary: {suggestedPrimaryArea}.</span>}
          {suggestionConfidence === 'low' && (
            <span className="inline-flex items-center rounded-pill border border-warning/40 bg-warning/10 text-warning px-1.5 py-0.5 text-[10px] font-heading font-semibold uppercase">double-check</span>
          )}
        </p>
      )}

      {scope !== 'national' && (
        <>
          <div className="flex flex-col gap-2">
            {areas.map((a, i) => (
              <div key={`${a.city}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-page px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-body min-w-0">
                  <input type="radio" name="primary-area" checked={!!a.primary} onChange={() => setPrimary(i)} disabled={!a.keep} className="accent-brand-cyan" />
                  <span className={a.keep ? 'text-text-primary' : 'text-text-muted line-through'}>
                    {[a.city, a.state].filter(Boolean).join(', ')}
                  </span>
                  {a.primary && a.keep && <span className="text-brand-cyan-dark text-[11px] font-heading font-semibold uppercase">primary</span>}
                </label>
                <button
                  type="button"
                  onClick={() => setAreas((prev) => prev.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))}
                  className={`text-xs font-heading font-semibold ${a.keep ? 'text-text-muted hover:text-error' : 'text-brand-cyan-dark hover:text-brand-cyan'}`}
                >
                  {a.keep ? 'Drop' : 'Keep'}
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea() } }} placeholder="City" className="flex-1 border border-border-default rounded-lg px-3 py-1.5 text-sm font-body bg-surface-card focus:outline-none focus:border-brand-cyan" />
            <input value={state} onChange={(e) => setState(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea() } }} placeholder="State" className="w-24 border border-border-default rounded-lg px-3 py-1.5 text-sm font-body bg-surface-card focus:outline-none focus:border-brand-cyan" />
            <button type="button" onClick={addArea} disabled={!city.trim()} className="text-brand-cyan-dark hover:text-brand-cyan text-sm font-heading font-semibold disabled:opacity-40">Add</button>
          </div>
        </>
      )}
    </div>
  )
}
