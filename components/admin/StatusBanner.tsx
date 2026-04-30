import type { Database } from '@/types/database'

type Session = Database['public']['Tables']['sessions']['Row']

const PHASE_LABELS: Record<number, string> = {
  0: 'Not started',
  1: 'Contact info',
  2: 'Domain lookup',
  3: 'MFP review',
  4: 'Gap filling',
  5: 'Assets',
  6: 'Wrap-up',
  7: 'Complete',
}

function fmt(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function StatusBanner({ session }: { session: Session }) {
  return (
    <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-heading font-semibold text-text-primary">Session Overview</h2>
        <span className="text-xs font-mono text-text-muted">{session.id}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-body">
        <div>
          <span className="text-text-secondary">Status: </span>
          <span className="text-text-primary font-semibold capitalize">{session.status.replace('_', ' ')}</span>
        </div>
        <div>
          <span className="text-text-secondary">Phase: </span>
          <span className="text-text-primary font-semibold">
            {session.current_phase} — {PHASE_LABELS[session.current_phase] ?? 'Unknown'}
          </span>
        </div>
        <div>
          <span className="text-text-secondary">Created: </span>
          <span className="text-text-primary">{fmt(session.created_at)}</span>
        </div>
        <div>
          <span className="text-text-secondary">Completed: </span>
          <span className="text-text-primary">{fmt(session.completed_at)}</span>
        </div>
        <div>
          <span className="text-text-secondary">Reminders sent: </span>
          <span className="text-text-primary">{session.reminder_count}</span>
        </div>
        <div>
          <span className="text-text-secondary">Approved: </span>
          <span className="text-text-primary">{fmt(session.approved_at)}</span>
        </div>
      </div>
    </div>
  )
}
