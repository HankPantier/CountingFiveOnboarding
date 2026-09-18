'use client'

export type Treatment = 'page' | 'block' | 'exclude'
export type Signal = 'weak' | 'moderate' | 'strong'
export type Confidence = 'high' | 'medium' | 'low'
export type ParentOption = { value: string; label: string }
// The AI's pre-selected recommendation for this item (from _meta.audit_suggestions).
export type ItemSuggestion = { treatment: Treatment; rationale: string; confidence?: Confidence; parent?: string }

const TREATMENT_LABEL: Record<Treatment, string> = { page: 'Own page', block: 'Content block', exclude: 'Exclude' }

const SIGNAL_STYLES: Record<Signal, string> = {
  strong: 'bg-brand-cyan/15 text-brand-cyan-dark border-brand-cyan/30',
  moderate: 'bg-surface-subtle text-text-secondary border-border-default',
  weak: 'bg-warning/10 text-warning border-warning/40',
}

function SignalBadge({ signal }: { signal?: Signal }) {
  if (!signal) return null
  return (
    <span className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[11px] font-heading font-semibold uppercase tracking-wide ${SIGNAL_STYLES[signal]}`}>
      {signal} signal
    </span>
  )
}

const OPTIONS: { value: Treatment; label: string; activeCls: string }[] = [
  { value: 'page', label: 'Own page', activeCls: 'bg-brand-cyan text-text-inverse' },
  { value: 'block', label: 'Content block', activeCls: 'bg-brand-navy text-text-inverse' },
  { value: 'exclude', label: 'Exclude', activeCls: 'bg-error/10 text-error' },
]

// A single reviewable area item (service / industry / sub-service) with the
// three-way Own page / Content block / Exclude control. When the item is a
// content block and parent options are supplied, a parent-page picker appears so
// the operator says which page it renders on.
export default function AuditReviewItemRow({
  name,
  note,
  signal,
  treatment,
  parent,
  parentOptions,
  onTreatment,
  onParent,
  pageLabel,
  suggestion,
}: {
  name: string
  note?: string
  signal?: Signal
  treatment: Treatment
  parent?: string
  parentOptions?: ParentOption[]
  onTreatment: (t: Treatment) => void
  onParent?: (p: string) => void
  pageLabel?: string
  suggestion?: ItemSuggestion
}) {
  const excluded = treatment === 'exclude'
  return (
    <div className="rounded-lg border border-border-default bg-surface-page px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-heading font-semibold ${excluded ? 'text-text-muted line-through' : 'text-text-primary'}`}>
              {name}
            </span>
            <SignalBadge signal={signal} />
          </div>
          {note && <p className="text-text-secondary text-xs font-body mt-0.5 line-clamp-2">{note}</p>}
        </div>
        <div className="flex shrink-0 rounded-pill border border-border-default overflow-hidden">
          {OPTIONS.map((o) => {
            const active = treatment === o.value
            const label = o.value === 'page' && pageLabel ? pageLabel : o.label
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onTreatment(o.value)}
                className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${active ? o.activeCls : 'bg-surface-card text-text-secondary hover:text-brand-navy'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {treatment === 'block' && parentOptions && parentOptions.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs font-body text-text-muted">Show as a section on:</label>
          <select
            value={parent ?? ''}
            onChange={(e) => onParent?.(e.target.value)}
            className="border border-border-default rounded-lg px-2 py-1 text-xs font-body bg-surface-card focus:outline-none focus:border-brand-cyan"
          >
            <option value="">Choose a parent page…</option>
            {parentOptions.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      )}

      {suggestion && (
        <p className="mt-1.5 text-xs font-body text-text-muted flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-brand-cyan-dark font-heading font-semibold">✦ AI</span>
          {treatment === suggestion.treatment ? (
            <span className="text-text-secondary font-heading font-semibold">suggests {TREATMENT_LABEL[suggestion.treatment]}:</span>
          ) : (
            <span className="text-text-secondary">
              suggested <span className="font-heading font-semibold">{TREATMENT_LABEL[suggestion.treatment]}</span>
              {' '}(you chose {TREATMENT_LABEL[treatment]}):
            </span>
          )}
          <span>{suggestion.rationale}</span>
          {suggestion.confidence === 'low' && (
            <span className="inline-flex items-center rounded-pill border border-warning/40 bg-warning/10 text-warning px-1.5 py-0.5 text-[10px] font-heading font-semibold uppercase">
              double-check
            </span>
          )}
        </p>
      )}
    </div>
  )
}
