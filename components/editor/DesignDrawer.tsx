'use client'

import DesignChat from '@/components/design-studio/DesignChat'
import { useDesignBaseline } from '@/components/design-studio/useDesignBaseline'

// The editor's quick-revise drawer: the Design Studio chat on the current
// draft theme, without the concept workflow. It shares the Studio chat's
// per-session history and saves every change as a design version. Admin-only
// (the design routes enforce it).
export default function DesignDrawer({
  sessionId,
  route,
  onCommitted,
  onOpenStudio,
  onClose,
}: {
  sessionId: string
  route: string
  onCommitted: () => void
  onOpenStudio: () => void
  onClose: () => void
}) {
  const baseline = useDesignBaseline(sessionId)

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[440px] max-w-[92vw] flex-col border-l border-border-default bg-surface-card shadow-elevated">
      <div className="flex items-start justify-between gap-3 border-b border-border-default bg-surface-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-heading text-sm font-semibold text-text-primary">Design</h2>
          <p className="mt-0.5 font-body text-xs text-text-muted">
            Colors, fonts, spacing, block styling. <strong className="font-semibold text-text-secondary">Changes apply to every page</strong>, saved as a version you can roll back.
          </p>
          <button
            type="button"
            onClick={onOpenStudio}
            className="mt-1 font-heading text-[11px] font-semibold text-brand-cyan hover:text-brand-navy"
          >
            Open full Design Studio →
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Design"
          className="text-lg leading-none text-text-muted hover:text-brand-navy"
        >
          ×
        </button>
      </div>
      {baseline.status === 'error' && (
        <p role="alert" className="border-b border-border-default bg-error/10 px-4 py-2 font-body text-[11px] text-error">
          {baseline.error} Changes can’t be saved until this is fixed in the Design Studio.
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {baseline.status === 'loading' ? (
          <p className="font-body text-xs text-text-muted">Preparing…</p>
        ) : (
          <DesignChat sessionId={sessionId} page={route} onCommitted={onCommitted} />
        )}
      </div>
    </aside>
  )
}
