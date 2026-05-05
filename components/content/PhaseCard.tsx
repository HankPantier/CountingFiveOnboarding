import PhaseStatusBadge, { type PhaseStatus } from './PhaseStatusBadge'

const PHASE_NAMES: Record<number, string> = {
  1: 'Color Palette',
  2: 'Sitemap Confirm',
  3: 'Research',
  4: 'Outline Review',
  5: 'Content Generation',
  6: 'Deliverables',
}

export default function PhaseCard({
  phase,
  status,
  children,
}: {
  phase: number
  status: PhaseStatus
  children?: React.ReactNode
}) {
  const isLocked = status === 'locked'

  return (
    <div
      className={`bg-surface-card border rounded-lg shadow-subtle overflow-hidden transition-opacity ${
        isLocked ? 'opacity-50' : ''
      } ${status === 'active' ? 'border-l-4 border-l-brand-cyan border-t border-r border-b border-border-default' : 'border-border-default'}`}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-navy text-text-inverse text-xs font-heading font-bold">
            {status === 'complete' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              phase
            )}
          </span>
          <h3 className="text-sm font-heading font-semibold text-text-primary">
            {PHASE_NAMES[phase] ?? `Phase ${phase}`}
          </h3>
        </div>
        <PhaseStatusBadge status={status} />
      </div>

      {!isLocked && children && (
        <div className="px-5 pb-5 pt-1 border-t border-border-default">
          {children}
        </div>
      )}
    </div>
  )
}
