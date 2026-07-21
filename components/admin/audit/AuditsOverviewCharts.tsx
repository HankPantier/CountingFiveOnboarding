'use client'

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AuditsOverview } from '@/lib/audit/report-aggregates'
import { gradeToken, type SemanticToken } from '@/lib/audit/report-format'
import type { Grade } from '@/types/audit-result'
import { BRAND, TOKEN_VAR, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

// Each 20-point score band mapped to the grade token it mostly represents.
const SCORE_BUCKET_TOKENS: SemanticToken[] = ['error', 'error', 'error', 'warning', 'success']

const panel = 'rounded-xl border border-border-default bg-surface-card p-4 shadow-subtle'
const panelTitle = 'mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary'

export default function AuditsOverviewCharts({ overview }: { overview: AuditsOverview }) {
  if (!overview.completed) return null

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className={panel}>
        <p className={panelTitle}>Score distribution</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={overview.scoreBuckets} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: BRAND.textMuted }} tickLine={false} axisLine={{ stroke: BRAND.border }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Audits']} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {overview.scoreBuckets.map((_, i) => (
                <Cell key={i} fill={TOKEN_VAR[SCORE_BUCKET_TOKENS[i]]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={panel}>
        <p className={panelTitle}>Grades</p>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={overview.grades} dataKey="count" nameKey="grade" innerRadius={42} outerRadius={68} isAnimationActive={false}>
              {overview.grades.map((g, i) => (
                <Cell key={i} fill={TOKEN_VAR[gradeToken(g.grade as Grade)]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [v, `Grade ${n}`]} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className={panel}>
        <p className={panelTitle}>By status</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={overview.statuses} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <XAxis dataKey="status" tick={{ fontSize: 10, fill: BRAND.textMuted }} tickLine={false} axisLine={{ stroke: BRAND.border }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Runs']} />
            <Bar dataKey="count" fill={BRAND.cyan} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
