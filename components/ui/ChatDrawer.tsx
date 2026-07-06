'use client'

import { useDialog } from './use-dialog'

// Shared right-hand drawer shell for the three AI chat modals (MBP, audit,
// content). Carries the dialog semantics + keyboard behavior the hand-rolled
// versions lacked: role/aria-modal, focus trap, Escape-to-close, focus restore.
export default function ChatDrawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const dialogRef = useDialog(onClose)

  return (
    <div className="fixed inset-0 z-50 flex">
      <button aria-label="Close" onClick={onClose} className="flex-1 cursor-pointer bg-brand-navy/40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-[460px] h-full bg-surface-page shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 h-14 flex-shrink-0 border-b border-border-default bg-surface-card">
          <span className="text-sm font-heading font-semibold text-brand-navy">{title}</span>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-brand-navy text-lg leading-none transition-colors"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="flex-1 min-h-0 p-3">{children}</div>
      </div>
    </div>
  )
}
