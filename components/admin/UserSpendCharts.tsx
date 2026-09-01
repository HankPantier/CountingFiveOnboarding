'use client'

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BRAND, SERIES, TOOLTIP_STYLE } from '@/components/admin/chart-theme'
import type { SpendSlice } from '@/components/admin/SpendBreakdownCharts'

const card = 'bg-surface-card border border-border-default rounded-xl shadow-subtle p-5'
const title = 'text-sm font-heading font-semibold text-text-muted uppercase tracking-wide mb-3'
const money = (v: number | string | ReadonlyArray<number | string> | undefined) =>
  `$${Number(Array.isArray(v) ? v[0] : (v ?? 0)).toFixed(2)}`

export default function UserSpendCharts({ users }: { users: SpendSlice[] }) {
  const data = users.filter((u) => u.cost > 0)
  if (data.length === 0) {
    return (
      <div className={`${card} mb-6`}>
        <p className="text-sm font-body text-text-muted py-8 text-center">No attributed usage yet.</p>
      </div>
    )
  }

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={card}>
        <h2 className={title}>Share by user</h2>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="cost" nameKey="name" innerRadius={56} outerRadius={90} isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [money(v), 'Spend']} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className={card}>
        <h2 className={title}>Top users by spend</h2>
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 8)}>
          <BarChart layout="vertical" data={data} margin={{ top: 0, right: 56, bottom: 0, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              tick={{ fontSize: 12, fill: BRAND.textSecondary }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [money(v), 'Spend']} />
            <Bar dataKey="cost" fill={BRAND.cyan} radius={4} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
