'use client'

import type { BrandFitResult } from '@/lib/content/brand-fit'

// Shared brand-conflict confirmation card — used by ResourcesPanel (seeds,
// draft notes) and OneOffPanel (free-form prompts). The parent owns the
// brand-amendment POST and the override re-run.
export default function BrandConflictCard({
  requestText,
  fit,
  amending,
  onRevise,
  onProceed,
  onAmendAndProceed,
}: {
  requestText: string
  fit: BrandFitResult
  amending: boolean
  onRevise: () => void
  onProceed: () => void
  onAmendAndProceed: () => void
}) {
  return (
    <div role="alert" className="mb-5 rounded-lg border border-warning/30 bg-warning/10 p-4">
      <h3 className="text-sm font-heading font-semibold text-brand-navy">
        This request conflicts with the documented brand voice
      </h3>
      <p className="mt-1 text-xs font-body text-text-muted">“{requestText}”</p>
      <ul className="mt-2 space-y-1">
        {fit.conflicts.map((c, i) => (
          <li key={i} className="text-xs font-body text-text-secondary">
            • {c}
          </li>
        ))}
      </ul>
      {fit.proposedAmendment && (
        <div className="mt-3 rounded border border-border-default bg-surface-card px-3 py-2">
          <p className="text-xs font-heading font-semibold text-brand-navy">
            Proposed brand update: {fit.proposedAmendment.summary}
          </p>
          <p className="mt-1 text-[11px] font-body text-text-muted">
            {[
              fit.proposedAmendment.toneAdjectivesAdd.length
                ? `Tone adds: ${fit.proposedAmendment.toneAdjectivesAdd.join(', ')}`
                : null,
              fit.proposedAmendment.toneToAvoidRemove.length
                ? `No longer avoiding: ${fit.proposedAmendment.toneToAvoidRemove.join(', ')}`
                : null,
              fit.proposedAmendment.aspirationalToneAppend
                ? `Aspiration: ${fit.proposedAmendment.aspirationalToneAppend}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={onRevise}
          className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
        >
          Revise request
        </button>
        <button
          onClick={onProceed}
          className="rounded-pill px-3.5 py-1.5 text-xs font-heading font-semibold text-text-secondary hover:text-brand-navy transition-colors"
        >
          Proceed off-brand (one time)
        </button>
        {fit.proposedAmendment && (
          <button
            onClick={onAmendAndProceed}
            disabled={amending}
            className="rounded-pill bg-brand-cyan px-3.5 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 disabled:bg-surface-subtle disabled:text-text-muted transition-colors"
          >
            {amending ? 'Updating brand…' : 'Update brand & proceed'}
          </button>
        )}
      </div>
    </div>
  )
}
