import { gradeToken, gradeWithModifier, score10, tokenForScore } from '@/lib/audit/report-format'

export { gradeToken }

const badgeBase =
  'inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em]'

const tokenClasses: Record<string, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning-strong/10 text-warning-strong',
  error: 'bg-error/10 text-error',
  muted: 'bg-surface-subtle text-text-muted',
}

/** Grade chip on the client-facing 0–10 scale: "C+ · 7.0". `score` is 0–100. */
export function GradeBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className={`${badgeBase} ${tokenClasses.muted}`}>N/A</span>
  }
  return (
    <span className={`${badgeBase} ${tokenClasses[tokenForScore(score)]}`}>
      {gradeWithModifier(score)} · {score10(score)}
    </span>
  )
}

const FOLDER_META: Record<string, { label: string; cls: string }> = {
  prospect: { label: 'Prospect', cls: tokenClasses.muted },
  working: { label: 'Working', cls: tokenClasses.muted },
  client: { label: 'Client', cls: tokenClasses.muted },
}

/** Lifecycle folder chip: Prospect / Working / Client. */
export function FolderBadge({ group }: { group: string }) {
  const meta = FOLDER_META[group] ?? { label: group, cls: tokenClasses.muted }
  return <span className={`${badgeBase} ${meta.cls}`}>{meta.label}</span>
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
    ? 'bg-brand-cyan/10 text-brand-cyan-dark'
    : status === 'complete'
      ? tokenClasses.success
      : status === 'error'
        ? tokenClasses.error
        : tokenClasses.muted
  return <span className={`${badgeBase} ${cls}`}>{STATUS_LABELS[status] ?? status}</span>
}
