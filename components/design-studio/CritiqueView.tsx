'use client'

import type { ConceptReviewDto } from '@/lib/design/run-types'
import { TONE_BAR, TONE_CHIP, TONE_TEXT, critiqueChip, revisionsLabel, scoreRows } from '@/lib/design/critique-ui'

// One concept's critique: verdict chip, revision count, the six rubric scores
// as compact bars, render-check failures, and (collapsed) reasons, issues and
// loop notes.
export default function CritiqueView({ review, iterations, maxRevisions }: { review: ConceptReviewDto; iterations: number; maxRevisions: number }) {
  const chip = critiqueChip(review)
  const latest = review.latest
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-subtle p-2">
      <div className="flex flex-wrap items-center gap-2">
        {chip && <span className={`rounded-pill border px-2 py-0.5 font-heading text-[10px] font-semibold ${TONE_CHIP[chip.tone]}`}>{chip.label}</span>}
        <span className="font-body text-[11px] text-text-muted">{revisionsLabel(iterations, maxRevisions)}</span>
        {!review.measured && <span className="font-body text-[11px] text-text-muted">· render checks not run</span>}
        {review.measured && review.unmeasuredViewports.length > 0 && (
          <span className="font-body text-[11px] text-text-muted">· {review.unmeasuredViewports.join(' + ')} render checks not run</span>
        )}
      </div>

      {latest && (
        <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1" aria-label="Critique scores">
          {scoreRows(latest).map((row) => (
            <div key={row.key} className="contents">
              <dt className="font-body text-[11px] text-text-secondary">{row.label}</dt>
              <dd className="h-1.5 overflow-hidden rounded-pill bg-border-default" aria-hidden="true">
                {/* Computed geometry (bar width) — the one inline style allowed here. */}
                <div className={`h-full rounded-pill ${TONE_BAR[row.tone]}`} style={{ width: `${row.pct}%` }} />
              </dd>
              <dd className={`font-heading text-[11px] font-semibold ${TONE_TEXT[row.tone]}`}>
                <span className="sr-only">{row.label}: </span>
                {row.score}/5
              </dd>
            </div>
          ))}
        </dl>
      )}

      {review.gateFailures.length > 0 && (
        <ul className="list-disc pl-4 font-body text-[11px] text-error" aria-label="Render-check failures">
          {review.gateFailures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {latest && (
        <details className="font-body text-[11px] text-text-secondary">
          <summary className="cursor-pointer font-heading font-semibold text-text-primary">Why these scores</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {scoreRows(latest)
              .filter((r) => r.reason)
              .map((r) => (
                <li key={r.key}>
                  <span className="font-semibold text-text-primary">{r.label}:</span> {r.reason}
                </li>
              ))}
          </ul>
          {latest.issues.length > 0 && (
            <ol className="mt-1 list-decimal pl-4">
              {latest.issues.map((issue, i) => (
                <li key={`${i}-${issue.area}`}>
                  <span className="font-semibold text-text-primary">{issue.area}:</span> {issue.problem} <span className="text-text-muted">→ {issue.fix}</span>
                </li>
              ))}
            </ol>
          )}
          {latest.summary && <p className="mt-1 italic">{latest.summary}</p>}
        </details>
      )}

      {review.renderWarnings.length > 0 && (
        <ul className="list-disc pl-4 font-body text-[11px] text-warning-strong" aria-label="Render-check warnings">
          {review.renderWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {review.notes.length > 0 && (
        <ul className="list-disc pl-4 font-body text-[11px] text-text-muted">
          {review.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
