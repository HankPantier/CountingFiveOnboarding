export type PhaseStatus = 'locked' | 'active' | 'awaiting_review' | 'complete' | 'error'

const styles: Record<PhaseStatus, string> = {
  locked:          'bg-surface-subtle text-text-muted',
  active:          'bg-blue-50 text-blue-700',
  awaiting_review: 'bg-amber-50 text-amber-700',
  complete:        'bg-green-50 text-green-700',
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
