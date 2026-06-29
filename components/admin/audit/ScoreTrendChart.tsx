'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BRAND, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

export interface TrendPoint {
  date: string
  score: number
}

export interface TrendCategory {
  label: string
  current: number
  previous: number | null
}

// Overall-score line across past runs, plus an optional current-vs-previous
// category comparison for the two most recent runs.
export default function ScoreTrendChart({
  trend,
  categories,
}: {
  trend: TrendPoint[]
  categories: TrendCategory[] | null
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
          Overall score over time
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: BRAND.textMuted }}
              tickLine={false}
              axisLine={{ stroke: BRAND.border }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: BRAND.textMuted }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Score']} />
            <Line
              type="monotone"
              dataKey="score"
              stroke={BRAND.cyan}
              strokeWidth={2}
              dot={{ r: 3, fill: BRAND.cyan }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {categories && (
        <div>
          <p className="mb-1 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
            Category scores — current vs. previous
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={categories} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: BRAND.textMuted }}
                tickLine={false}
                axisLine={{ stroke: BRAND.border }}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: BRAND.textMuted }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar name="Previous" dataKey="previous" fill={BRAND.textMuted} radius={2} isAnimationActive={false} />
              <Bar name="Current" dataKey="current" fill={BRAND.cyan} radius={2} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
