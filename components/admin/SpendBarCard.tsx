'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BRAND, TOOLTIP_STYLE } from '@/components/admin/chart-theme'
import type { SpendSlice } from '@/components/admin/SpendBreakdownCharts'

const card = 'bg-surface-card border border-border-default rounded-xl shadow-subtle p-5'
const title = 'text-sm font-heading font-semibold text-text-muted uppercase tracking-wide mb-3'
const money = (v: number | string | ReadonlyArray<number | string> | undefined) =>
  `$${Number(Array.isArray(v) ? v[0] : (v ?? 0)).toFixed(2)}`

// Generic horizontal spend-bar card (title + {name, cost}[]). Long labels (e.g.
// "User → Client" pairs) get a wider axis gutter than the breakdown bars.
export default function SpendBarCard({ heading, data }: { heading: string; data: SpendSlice[] }) {
  const rows = data.filter((d) => d.cost > 0)
  return (
    <div className={`${card} mb-6`}>
      <h2 className={title}>{heading}</h2>
      {rows.length === 0 ? (
        <p className="text-sm font-body text-text-muted py-8 text-center">No attributed usage yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34 + 8)}>
          <BarChart layout="vertical" data={rows} margin={{ top: 0, right: 56, bottom: 0, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={240}
              tick={{ fontSize: 12, fill: BRAND.textSecondary }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [money(v), 'Spend']} />
            <Bar dataKey="cost" fill={BRAND.cyan} radius={4} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
