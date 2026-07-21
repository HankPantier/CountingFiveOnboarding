import type { AuditsOverview } from '@/lib/audit/report-aggregates'

// A single flat, on-brand bar chart (no chart dependency) mirroring the
// onboarding PipelineChart. Consumes the same AuditsOverview the list page
// already computes via auditsOverview(); grades/statuses go unused here.
export default function AuditsOverviewCharts({ overview }: { overview: AuditsOverview }) {
  if (!overview.completed) return null

  const buckets = overview.scoreBuckets
  const max = Math.max(1, ...buckets.map((b) => b.count))

  return (
    <div className="mb-6 rounded-xl border border-border-default bg-surface-card p-6 shadow-subtle">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-[15px] font-semibold text-brand-navy">Score distribution</h2>
        <span className="font-body text-xs text-text-muted">{overview.completed} scored</span>
      </div>
      <div className="mt-5 flex items-end gap-4">
        {buckets.map((b, i) => (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-2.5">
            <div className="font-heading text-xl font-bold tabular-nums text-brand-navy">{b.count}</div>
            <div className="flex h-28 w-full items-end justify-center">
              <div
                className={`w-3/5 max-w-[64px] rounded-t-lg ${i === buckets.length - 1 ? 'bg-brand-navy' : 'bg-brand-cyan'}`}
                style={{ height: `${Math.round((b.count / max) * 100)}%` }}
              />
            </div>
            <div className="text-center font-heading text-[11.5px] font-semibold text-text-secondary">{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
