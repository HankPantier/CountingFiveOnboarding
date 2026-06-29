'use client'

import {
  Bar,
  BarChart,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SessionsOverview } from '@/lib/audit/report-aggregates'
import { BRAND, SERIES, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

const panelTitle = 'mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy'

export default function SessionsFunnelChart({ overview }: { overview: SessionsOverview }) {
  if (!overview.total) return null

  return (
    <details className="mb-4 rounded-lg border border-border-default bg-surface-card shadow-subtle" open>
      <summary className="cursor-pointer list-none px-5 py-3 font-heading text-sm font-semibold text-brand-navy [&::-webkit-details-marker]:hidden">
        Onboarding pipeline · {overview.total} active
      </summary>
      <div className="grid grid-cols-1 gap-4 border-t border-border-default p-5 lg:grid-cols-2">
        <div>
          <p className={panelTitle}>Sessions reaching each phase</p>
          <ResponsiveContainer width="100%" height={260}>
            <FunnelChart>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Sessions']} />
              <Funnel dataKey="count" data={overview.phases} isAnimationActive={false}>
                <LabelList position="right" dataKey="label" style={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
                <LabelList position="left" dataKey="count" style={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text-primary)' }} />
                {overview.phases.map((_, i) => (
                  <Cell key={i} fill={SERIES[i % SERIES.length]} />
                ))}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className={panelTitle}>By status</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={overview.statuses} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <XAxis dataKey="status" tick={{ fontSize: 10, fill: BRAND.textMuted }} tickLine={false} axisLine={{ stroke: BRAND.border }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={false} width={32} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Sessions']} />
              <Bar dataKey="count" fill={BRAND.cyan} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </details>
  )
}
