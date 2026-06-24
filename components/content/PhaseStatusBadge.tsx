export type PhaseStatus = 'locked' | 'active' | 'awaiting_review' | 'complete' | 'error'

const styles: Record<PhaseStatus, string> = {
  locked:          'bg-surface-subtle text-text-muted',
  active:          'bg-info/10 text-info',
  awaiting_review: 'bg-warning/10 text-warning-strong',
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
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}
