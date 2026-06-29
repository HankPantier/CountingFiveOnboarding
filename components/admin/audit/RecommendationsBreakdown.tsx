'use client'

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { RecommendationStats } from '@/lib/audit/report-aggregates'
import type { SemanticToken } from '@/lib/audit/report-format'
import { BRAND, TOKEN_VAR, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

const EFFORT_TOKENS: SemanticToken[] = ['success', 'warning', 'error']

const panel = 'rounded-lg border border-border-default bg-surface-page p-4'
const panelTitle = 'mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy'

export default function RecommendationsBreakdown({ stats }: { stats: RecommendationStats }) {
  if (!stats.total) return null

  const categories = stats.byCategory.slice(0, 8)
  const effort = [
    { label: 'Low', count: stats.byEffort.Low },
    { label: 'Medium', count: stats.byEffort.Medium },
    { label: 'High', count: stats.byEffort.High },
  ]

  return (
    <div className="mb-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-error/10 px-3 py-1 font-heading text-xs font-semibold text-error">
          {stats.byPriority.critical} Critical
        </span>
        <span className="inline-flex items-center rounded-full bg-warning/15 px-3 py-1 font-heading text-xs font-semibold text-warning-strong">
          {stats.byPriority.warning} Warning
        </span>
        <span className="font-body text-xs text-text-muted">{stats.total} total recommendations</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={panel}>
          <p className={panelTitle}>By section</p>
          <ResponsiveContainer width="100%" height={Math.max(120, categories.length * 30 + 8)}>
            <BarChart layout="vertical" data={categories} margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis
                type="category"
                dataKey="category"
                width={130}
                tick={{ fontSize: 11, fill: BRAND.textSecondary }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Recs']} />
              <Bar dataKey="count" fill={BRAND.cyan} radius={3} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={panel}>
          <p className={panelTitle}>By effort</p>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={effort} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={{ stroke: BRAND.border }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={false} width={32} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Recs']} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {effort.map((_, i) => (
                  <Cell key={i} fill={TOKEN_VAR[EFFORT_TOKENS[i]]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
