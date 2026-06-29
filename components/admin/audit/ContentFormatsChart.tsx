'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ContentLibraryFormat } from '@/types/audit-result'
import { BRAND, TOOLTIP_STYLE } from '@/components/admin/chart-theme'

// Horizontal bar of published content counts by format.
export default function ContentFormatsChart({ formats }: { formats: ContentLibraryFormat[] }) {
  const data = [...formats].sort((a, b) => b.count - a.count)
  const height = Math.max(120, data.length * 34 + 8)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 0, right: 28, bottom: 0, left: 8 }}>
        <XAxis type="number" allowDecimals={false} hide />
        <YAxis
          type="category"
          dataKey="type"
          width={140}
          tick={{ fontSize: 12, fill: BRAND.textSecondary }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Pieces']} />
        <Bar dataKey="count" fill={BRAND.cyan} radius={4} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
