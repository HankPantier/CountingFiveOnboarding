import { clientHealth, healthTone, type HealthInput } from '@/lib/admin/client-health'

// Ring stroke colors pull from the CSS custom properties defined in globals.css
// (@theme), so they stay in lock-step with the token palette.
const RING: Record<string, string> = {
  good: 'var(--color-success)',        // deep teal
  warn: 'var(--color-warning-strong)', // amber-800 (readable)
  risk: 'var(--color-error)',          // plum
}
const TEXT: Record<string, string> = {
  good: 'text-success',
  warn: 'text-warning-strong',
  risk: 'text-error',
}

// Compact 0–100 client-health dial. Pass a `score` directly, or a session-shaped
// object via `from` to derive it with clientHealth().
export default function HealthRing({
  score,
  from,
  size = 36,
}: {
  score?: number
  from?: HealthInput
  size?: number
}) {
  const value = score ?? (from ? clientHealth(from) : 0)
  const tone = healthTone(value)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-surface-subtle)" strokeWidth={3.5} />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke={RING[tone]}
          strokeWidth={3.5}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${value} 100`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-heading text-[11px] font-semibold ${TEXT[tone]}`}>
        {value}
      </span>
    </div>
  )
}
