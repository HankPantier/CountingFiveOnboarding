'use client'
import { useState } from 'react'
import AuditChat from '@/components/admin/audit/AuditChat'

const ghostButton =
  'rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading text-xs font-semibold whitespace-nowrap text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50'

export default function AuditChatModal({
  auditId,
  initialMessages,
}: {
  auditId: string
  initialMessages: { role: string; content: string }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)} className={ghostButton}>
        Edit with AI
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="flex-1 bg-brand-navy/40"
          />
          <div className="w-full max-w-[460px] h-full bg-surface-page shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 flex-shrink-0 border-b border-border-default bg-surface-card">
              <span className="text-sm font-heading font-semibold text-brand-navy">Edit report with AI</span>
              <button
                onClick={() => setOpen(false)}
                className="text-text-muted hover:text-brand-navy text-lg leading-none transition-colors"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <AuditChat auditId={auditId} initialMessages={initialMessages} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
