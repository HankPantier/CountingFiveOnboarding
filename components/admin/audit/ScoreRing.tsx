import type { Grade } from '@/types/audit-result'
import { gradeToken } from './AuditBadges'

const RING_STROKE: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  muted: 'text-text-muted',
}

/** Circular score dial. Uses currentColor for the arc so the token class drives
 * the color. Pure / server-renderable (no client JS). */
export function ScoreRing({
  score,
  grade,
  size = 168,
}: {
  score: number
  grade: Grade
  size?: number
}) {
  const stroke = 12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const dash = (clamped / 100) * circumference
  const token = gradeToken(grade)

  return (
    <div
      role="img"
      aria-label={`Overall score ${score} out of 100, grade ${grade}`}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className={RING_STROKE[token]} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="text-border-default"
          stroke="currentColor"
          opacity={0.25}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading font-bold text-text-primary" style={{ fontSize: size * 0.28 }}>
          {score}
        </span>
        <span className="font-heading font-semibold text-text-secondary text-sm">Grade {grade}</span>
      </div>
    </div>
  )
}
