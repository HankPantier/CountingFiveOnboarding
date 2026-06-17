'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import type { DailyPoint } from '@/lib/tokens/aggregate'

type Metric = 'cost' | 'tokens'

// series keys: 'all' plus each task. Colors come from the palette via the
// Tailwind v4 CSS variables (no hardcoded hex), per design rule 1.
const TASK_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'audit', label: 'Audit' },
  { key: 'content', label: 'Content' },
]

function formatCost(v: number): string {
  return `$${v.toFixed(2)}`
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

export default function TokenTrendChart({ series }: { series: Record<string, DailyPoint[]> }) {
  const [task, setTask] = useState('all')
  const [metric, setMetric] = useState<Metric>('cost')

  const data = series[task] ?? []
  const fmt = metric === 'cost' ? formatCost : formatTokens

  const pill = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-heading font-semibold transition-colors ${
      active
        ? 'bg-brand-cyan text-text-inverse'
        : 'bg-surface-subtle text-text-secondary hover:text-text-primary'
    }`

  return (
    <div className="bg-surface-card border border-border-default rounded-lg shadow-subtle p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-heading font-bold text-brand-navy">Usage over time</h2>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {TASK_TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTask(t.key)} className={pill(task === t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setMetric('cost')} className={pill(metric === 'cost')}>
              Cost
            </button>
            <button type="button" onClick={() => setMetric('tokens')} className={pill(metric === 'tokens')}>
              Tokens
            </button>
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="text-sm font-body text-text-muted py-16 text-center">No usage recorded for this view yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand-cyan)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--color-brand-cyan)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border-default)' }}
            />
            <YAxis
              tickFormatter={fmt}
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              formatter={(value) => [fmt(Number(value)), metric === 'cost' ? 'Cost' : 'Tokens']}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid var(--color-border-default)',
              }}
            />
            <Area
              type="monotone"
              dataKey={metric}
              stroke="var(--color-brand-cyan)"
              strokeWidth={2}
              fill="url(#trendFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
