'use client'

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { KeywordBar } from '@/lib/audit/report-aggregates'
import { BRAND, TOKEN_VAR } from '@/components/admin/chart-theme'

// Horizontal bar per keyword; bar length = visibility (0–100, higher = better),
// colored by SERP band. The actual rank is shown as a right-side label.
export default function KeywordRankChart({ data }: { data: KeywordBar[] }) {
  const rows = data.map((d) => ({ ...d, rankLabel: d.rank === null ? 'NR' : `#${d.rank}` }))
  const height = Math.max(120, rows.length * 38 + 16)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={rows}
        margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
        barCategoryGap={10}
      >
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="keyword"
          width={150}
          tick={{ fontSize: 12, fill: BRAND.textSecondary }}
          tickLine={false}
          axisLine={false}
        />
        <Bar dataKey="visibility" radius={4} isAnimationActive={false}>
          {rows.map((d, i) => (
            <Cell key={i} fill={TOKEN_VAR[d.token]} />
          ))}
          <LabelList
            dataKey="rankLabel"
            position="right"
            style={{ fontSize: 11, fontWeight: 600, fill: BRAND.textSecondary }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
