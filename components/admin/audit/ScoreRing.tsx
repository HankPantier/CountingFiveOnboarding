import { gradeWithModifier, score10, tokenForScore } from '@/lib/audit/report-format'

// These drive the SVG arc color via currentColor — a graphic fill, NOT text.
// `warning: 'text-warning'` is intentionally the bright amber; do NOT "fix" it
// to text-warning-strong (that AA rule is for warning *text*, not the gauge arc).
const RING_STROKE: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  muted: 'text-text-muted',
}

/** Circular score dial on the client-facing 0–10 scale. `score` is 0–100; the
 * arc reflects it and the center shows "x.x / out of 10 / grade". Uses
 * currentColor for the arc so the token class drives the color. Pure /
 * server-renderable (no client JS). */
export function ScoreRing({ score, size = 168 }: { score: number; size?: number }) {
  const stroke = 12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const dash = (clamped / 100) * circumference
  const token = tokenForScore(score)
  const grade = gradeWithModifier(score)

  return (
    <div
      role="img"
      aria-label={`Overall score ${score10(score)} out of 10, grade ${grade}`}
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
        <span className="font-heading font-bold text-text-primary" style={{ fontSize: size * 0.26 }}>
          {score10(score)}
        </span>
        <span className="font-body text-xs text-text-secondary">out of 10</span>
        <span className={`font-heading text-sm font-bold ${RING_STROKE[token]}`}>{grade}</span>
      </div>
    </div>
  )
}

/** Compact donut echoing the hero ring at section-header scale: just the arc and
 * the 0–10 number (the adjacent GradeBadge carries the letter). Pure SVG /
 * server-renderable. */
export function MiniGauge({ score, size = 44 }: { score: number; size?: number }) {
  const stroke = 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const dash = (clamped / 100) * circumference
  const token = tokenForScore(score)

  return (
    <div
      role="img"
      aria-label={`Score ${score10(score)} out of 10`}
      className="relative inline-flex shrink-0 items-center justify-center"
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
      <span
        className="absolute font-heading font-bold text-text-primary"
        style={{ fontSize: size * 0.3 }}
      >
        {score10(score)}
      </span>
    </div>
  )
}
