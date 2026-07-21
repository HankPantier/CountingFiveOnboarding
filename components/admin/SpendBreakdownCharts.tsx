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
import { BRAND, SERIES, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

export interface SpendSlice {
  name: string
  cost: number
}

const card = 'bg-surface-card border border-border-default rounded-xl shadow-subtle p-5'
const title = 'text-sm font-heading font-semibold text-text-muted uppercase tracking-wide mb-3'
const money = (v: number | string | ReadonlyArray<number | string> | undefined) =>
  `$${Number(Array.isArray(v) ? v[0] : (v ?? 0)).toFixed(2)}`

function CostBars({ data }: { data: SpendSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34 + 8)}>
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
  )
}

export default function SpendBreakdownCharts({
  categories,
  models,
  clients,
}: {
  categories: SpendSlice[]
  models: SpendSlice[]
  clients: SpendSlice[]
}) {
  const cats = categories.filter((c) => c.cost > 0)

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={card}>
        <h2 className={title}>Spend by category</h2>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={cats} dataKey="cost" nameKey="name" innerRadius={52} outerRadius={84} isAnimationActive={false}>
              {cats.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [money(v), 'Spend']} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className={card}>
        <h2 className={title}>Spend by model</h2>
        <CostBars data={models} />
      </div>

      {clients.length > 0 && (
        <div className={`${card} lg:col-span-2`}>
          <h2 className={title}>Top clients by spend</h2>
          <CostBars data={clients} />
        </div>
      )}
    </div>
  )
}
