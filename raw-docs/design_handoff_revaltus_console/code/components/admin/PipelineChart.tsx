import type { SessionsOverview } from '@/lib/audit/report-aggregates'

// Operator-facing stage labels for phases 1–7. `overview.phases[i].count` is the
// number of sessions that have reached AT LEAST phase i (monotonic funnel), so
// the bars naturally decrease left → right.
const STAGE_LABELS = ['Contact', 'Processing', 'Review', 'Questions', 'Files', 'Generation', 'Approved']

// Replaces the old recharts SessionsFunnelChart with a flat, on-brand bar chart
// (no chart dependency). Consumes the same SessionsOverview the dashboard page
// already computes via sessionsOverview().
export default function PipelineChart({ overview }: { overview: SessionsOverview }) {
  if (!overview.total) return null

  const stages = STAGE_LABELS.map((label, i) => ({ label, count: overview.phases[i + 1]?.count ?? 0 }))
  const max = Math.max(1, ...stages.map((s) => s.count))

  return (
    <div className="rounded-xl border border-border-default bg-surface-card p-6 shadow-subtle">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-[15px] font-semibold text-brand-navy">Onboarding pipeline</h2>
        <span className="font-body text-xs text-text-muted">{overview.total} active</span>
      </div>
      <div className="mt-5 flex items-end gap-4">
        {stages.map((s, i) => (
          <div key={s.label} className="flex flex-1 flex-col items-center gap-2.5">
            <div className="font-heading text-xl font-bold tabular-nums text-brand-navy">{s.count}</div>
            <div className="flex h-28 w-full items-end justify-center">
              <div
                className={`w-3/5 max-w-[64px] rounded-t-lg ${i === stages.length - 1 ? 'bg-brand-navy' : 'bg-brand-cyan'}`}
                style={{ height: `${Math.round((s.count / max) * 100)}%` }}
              />
            </div>
            <div className="text-center font-heading text-[11.5px] font-semibold text-text-secondary">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
