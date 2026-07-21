import Link from 'next/link'

export interface StatCardProps {
  label: string
  value: string | number
  /** Small line under the value (e.g. "last 30 days", "+2 this week"). */
  context?: string
  /** 'good' tints the context teal; 'muted' is the default neutral. */
  tone?: 'good' | 'muted'
  href?: string
  /** Optional sparkline series. Only pass this if you actually track a short
   *  time-series for the metric — otherwise leave it off (no fake data). */
  spark?: number[]
}

function Sparkline({ data }: { data: number[] }) {
  const mn = Math.min(...data)
  const mx = Math.max(...data)
  const r = mx - mn || 1
  const n = data.length
  const pts = data.map((v, i) => `${((i / (n - 1)) * 100).toFixed(1)},${(38 - ((v - mn) / r) * 32 - 3).toFixed(1)}`)
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height={36} className="mt-1 block" aria-hidden="true">
      <polygon points={`${pts.join(' ')} 100,40 0,40`} fill="rgba(9,129,149,.08)" />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="var(--color-brand-cyan)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// The elevated KPI card used across the operator console. Renders as a Link when
// `href` is provided, otherwise a plain div.
export default function StatCard({ label, value, context, tone = 'muted', href, spark }: StatCardProps) {
  const inner = (
    <>
      <span className="font-heading text-xs font-semibold text-text-secondary">{label}</span>
      <div className="mt-2 font-heading text-[27px] font-bold leading-none text-brand-navy tabular-nums">{value}</div>
      {context && (
        <div className={`mt-1.5 font-body text-xs font-semibold ${tone === 'good' ? 'text-success' : 'text-text-muted'}`}>
          {context}
        </div>
      )}
      {spark && <Sparkline data={spark} />}
    </>
  )
  const base = 'block rounded-xl border border-border-default bg-surface-card p-5 shadow-subtle transition-all'
  return href ? (
    <Link href={href} className={`${base} hover:border-brand-cyan hover:shadow-medium`}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  )
}
