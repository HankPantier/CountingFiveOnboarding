import { tokenForScore, type SemanticToken } from '@/lib/audit/report-format'

const FILL: Record<SemanticToken, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  muted: 'bg-text-muted',
}

/** Coax a finding/sub-score display value into a 0–100 percentage for a bar, or
 * null when it isn't a bar-able quantity. Percentage findings (label "% …", from
 * `pct_*` keys) and 0–10 sub-scores ("8/10") qualify; counts, "Yes"/"No", and
 * free text don't. */
export function barPercent(label: string, value: string): number | null {
  const outOfTen = value.match(/^(\d+(?:\.\d+)?)\s*\/\s*10$/)
  if (outOfTen) return clamp(Number(outOfTen[1]) * 10)
  if (label.startsWith('% ')) {
    const n = Number(value)
    if (Number.isFinite(n)) return clamp(n)
  }
  return null
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/** Thin grade-colored progress bar for a 0–100 metric. Pure CSS — server
 * renderable and safe for the static export. */
export function MetricBar({ pct }: { pct: number }) {
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border-default">
      <div className={`h-1.5 rounded-full ${FILL[tokenForScore(pct)]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
