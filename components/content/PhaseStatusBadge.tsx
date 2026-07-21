export type PhaseStatus = 'locked' | 'active' | 'awaiting_review' | 'complete' | 'error'

const styles: Record<PhaseStatus, string> = {
  locked:          'bg-surface-subtle text-text-muted',
  active:          'bg-brand-cyan/10 text-brand-cyan-dark',
  awaiting_review: 'bg-warning-strong/10 text-warning-strong',
  complete:        'bg-success/10 text-success',
  error:           'bg-error/10 text-error',
}

const labels: Record<PhaseStatus, string> = {
  locked:          'Locked',
  active:          'Active',
  awaiting_review: 'Awaiting Review',
  complete:        'Complete',
  error:           'Error',
}

export default function PhaseStatusBadge({ status }: { status: PhaseStatus }) {
  return (
    <span className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}
