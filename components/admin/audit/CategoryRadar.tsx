'use client'

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'

export interface RadarDatum {
  label: string
  score: number
}

// Spider chart of the nine scored categories on a fixed 0–100 axis so the shape
// reads as absolute strength, not auto-scaled to the max. Colors come from the
// palette via CSS variables (no hardcoded hex), per design rule 1. In-app only —
// the standalone HTML export keeps its static dashboard.
export default function CategoryRadar({ data }: { data: RadarDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} outerRadius="70%">
        <PolarGrid stroke="var(--color-border-default)" />
        <PolarAngleAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} tickCount={5} />
        <Radar
          dataKey="score"
          stroke="var(--color-brand-cyan)"
          fill="var(--color-brand-cyan)"
          fillOpacity={0.22}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}
