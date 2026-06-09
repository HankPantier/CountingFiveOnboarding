'use client'
import { useState } from 'react'
import MbpChat from '@/components/admin/mbp/MbpChat'

export default function MbpChatModal({
  sessionId,
  initialMessages,
}: {
  sessionId: string
  initialMessages: { role: string; content: string }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-2.5 rounded-pill transition-all hover:bg-brand-cyan-dark"
      >
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
              <span className="text-sm font-heading font-semibold text-brand-navy">Edit MBP with AI</span>
              <button
                onClick={() => setOpen(false)}
                className="text-text-muted hover:text-brand-navy text-lg leading-none transition-colors"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <MbpChat sessionId={sessionId} initialMessages={initialMessages} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
