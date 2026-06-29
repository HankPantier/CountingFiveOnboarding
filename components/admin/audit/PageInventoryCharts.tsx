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
import type { PageInventoryStats } from '@/lib/audit/report-aggregates'
import type { SemanticToken } from '@/lib/audit/report-format'
import { BRAND, TOKEN_VAR, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

const ISSUE_TOKENS: SemanticToken[] = ['success', 'warning', 'error', 'error']

const panel = 'rounded-lg border border-border-default bg-surface-page p-4'
const panelTitle = 'mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy'

export default function PageInventoryCharts({ stats }: { stats: PageInventoryStats }) {
  const statusData = [
    { name: '2xx OK', value: stats.status.ok, token: 'success' as SemanticToken },
    { name: '3xx Redirect', value: stats.status.redirect, token: 'warning' as SemanticToken },
    { name: '4xx/5xx Error', value: stats.status.error, token: 'error' as SemanticToken },
  ].filter((d) => d.value > 0)

  const schemaData = [
    { name: 'With schema', value: stats.schemaCoveragePct, token: 'success' as SemanticToken },
    { name: 'No schema', value: 100 - stats.schemaCoveragePct, token: 'muted' as SemanticToken },
  ]

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className={panel}>
        <p className={panelTitle}>HTTP status</p>
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} isAnimationActive={false}>
              {statusData.map((d, i) => (
                <Cell key={i} fill={TOKEN_VAR[d.token]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className={panel}>
        <p className={panelTitle}>Schema coverage — {stats.schemaCoveragePct}%</p>
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={schemaData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} isAnimationActive={false}>
              {schemaData.map((d, i) => (
                <Cell key={i} fill={TOKEN_VAR[d.token]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, '']} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className={panel}>
        <p className={panelTitle}>Word count distribution</p>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={stats.wordBuckets} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: BRAND.textMuted }} tickLine={false} axisLine={{ stroke: BRAND.border }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Pages']} />
            <Bar dataKey="count" fill={BRAND.cyan} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={panel}>
        <p className={panelTitle}>Issues per page</p>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={stats.issueBuckets} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: BRAND.textMuted }} tickLine={false} axisLine={{ stroke: BRAND.border }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.textMuted }} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Pages']} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {stats.issueBuckets.map((_, i) => (
                <Cell key={i} fill={TOKEN_VAR[ISSUE_TOKENS[i]]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
