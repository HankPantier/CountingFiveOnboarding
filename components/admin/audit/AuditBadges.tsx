import type { Grade } from '@/types/audit-result'
import { gradeToken } from '@/lib/audit/report-format'

export { gradeToken }

const badgeBase =
  'inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-heading font-semibold'

const tokenClasses: Record<string, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning-strong',
  error: 'bg-error/10 text-error',
  muted: 'bg-surface-subtle text-text-muted',
}

export function GradeBadge({ grade, score }: { grade: Grade | null; score: number | null }) {
  if (grade === null || score === null) {
    return <span className={`${badgeBase} ${tokenClasses.muted}`}>N/A</span>
  }
  return (
    <span className={`${badgeBase} ${tokenClasses[gradeToken(grade)]}`}>
      {grade} · {score}
    </span>
  )
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  crawling: 'Crawling',
  analyzing: 'Analyzing',
  scoring: 'Scoring',
  rendering: 'Rendering',
  complete: 'Complete',
  error: 'Error',
}

const RUNNING = ['crawling', 'analyzing', 'scoring', 'rendering']

export function AuditStatusBadge({ status }: { status: string }) {
  const cls = RUNNING.includes(status)
    ? 'bg-info/10 text-info'
    : status === 'complete'
      ? tokenClasses.success
      : status === 'error'
        ? tokenClasses.error
        : tokenClasses.muted
  return <span className={`${badgeBase} ${cls}`}>{STATUS_LABELS[status] ?? status}</span>
}
