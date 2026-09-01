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
  Legend,
} from 'recharts'
import type { DailyPoint, UserDaily } from '@/lib/tokens/aggregate'
import { SERIES } from '@/components/admin/chart-theme'

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

// Build the stacked-by-user dataset for the active metric: one row per date with
// a numeric column per user series (0 where a user had no spend that day).
function buildUserRows(userSeries: UserDaily[], metric: Metric): Record<string, number | string>[] {
  const dates = [...new Set(userSeries.flatMap((s) => s.points.map((p) => p.date)))].sort()
  return dates.map((date) => {
    const row: Record<string, number | string> = { date }
    for (const s of userSeries) {
      const pt = s.points.find((p) => p.date === date)
      row[s.key] = pt ? (metric === 'cost' ? pt.cost : pt.tokens) : 0
    }
    return row
  })
}

export default function TokenTrendChart({
  series,
  userSeries,
}: {
  series: Record<string, DailyPoint[]>
  userSeries?: UserDaily[]
}) {
  const [task, setTask] = useState('all')
  const [metric, setMetric] = useState<Metric>('cost')
  const [mode, setMode] = useState<'task' | 'user'>('task')

  const fmt = metric === 'cost' ? formatCost : formatTokens
  const byUser = mode === 'user' && !!userSeries?.length
  const taskData = series[task] ?? []
  const userRows = byUser ? buildUserRows(userSeries!, metric) : []
  const hasData = byUser ? userRows.length > 0 : taskData.length > 0

  const pill = (active: boolean) =>
    `px-3 py-1 rounded-pill text-xs font-heading font-semibold transition-colors ${
      active
        ? 'bg-brand-cyan text-text-inverse'
        : 'bg-surface-subtle text-text-secondary hover:text-text-primary'
    }`

  return (
    <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-heading font-bold text-brand-navy">Usage over time</h2>
        <div className="flex flex-wrap items-center gap-3">
          {userSeries && userSeries.length > 0 && (
            <div className="flex gap-1">
              <button type="button" onClick={() => setMode('task')} className={pill(mode === 'task')}>
                By task
              </button>
              <button type="button" onClick={() => setMode('user')} className={pill(mode === 'user')}>
                By user
              </button>
            </div>
          )}
          {!byUser && (
            <div className="flex gap-1">
              {TASK_TABS.map((t) => (
                <button key={t.key} type="button" onClick={() => setTask(t.key)} className={pill(task === t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
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

      {!hasData ? (
        <p className="text-sm font-body text-text-muted py-16 text-center">No usage recorded for this view yet.</p>
      ) : byUser ? (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={userRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
              formatter={(value, name) => [fmt(Number(value)), labelFor(userSeries!, String(name))]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border-default)' }}
            />
            <Legend formatter={(value) => labelFor(userSeries!, String(value))} wrapperStyle={{ fontSize: 12 }} />
            {userSeries!.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stackId="users"
                stroke={SERIES[i % SERIES.length]}
                fill={SERIES[i % SERIES.length]}
                fillOpacity={0.75}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={taskData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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

function labelFor(userSeries: UserDaily[], key: string): string {
  return userSeries.find((s) => s.key === key)?.label ?? key
}
