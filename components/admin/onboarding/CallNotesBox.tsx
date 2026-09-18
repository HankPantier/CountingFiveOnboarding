'use client'

// Freeform call-notes field retained on the Audit Review step. Controlled by the
// parent (AuditReview owns the value and persists it in the consolidated submit),
// with the same guiding prompts the old notes-only screen showed.
const GUIDING_PROMPTS: { heading: string; hint: string }[] = [
  { heading: 'Firm background', hint: 'Founding year, history/origin, growth goals' },
  { heading: 'Differentiators', hint: 'What sets them apart, in their own words' },
  { heading: 'Ideal clients', hint: 'Who they want more of; typical revenue/stage; who decides' },
  { heading: 'Brand & tone', hint: 'How they sound today vs. aspirational; words to avoid' },
  { heading: 'Anything else', hint: 'Context the structured decisions above don’t capture' },
]

export default function CallNotesBox({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <label htmlFor="call-notes" className="block text-sm font-heading font-semibold text-text-primary mb-2">
          Call notes
        </label>
        <textarea
          id="call-notes"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Anything from the call the structured decisions above don't capture — write naturally. Saved when you submit the review."
          rows={10}
          className="w-full border border-border-default rounded-2xl px-4 py-3 text-sm font-body bg-surface-page focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-all duration-150"
        />
      </div>
      <aside className="bg-surface-card border border-border-default rounded-lg p-4">
        <p className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Worth capturing
        </p>
        <ul className="space-y-3">
          {GUIDING_PROMPTS.map((p) => (
            <li key={p.heading}>
              <p className="text-sm font-heading font-semibold text-text-primary">{p.heading}</p>
              <p className="text-xs font-body text-text-muted mt-0.5">{p.hint}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
