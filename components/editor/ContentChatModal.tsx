'use client'
import { useState, useEffect } from 'react'
import ContentChat from '@/components/editor/ContentChat'

export default function ContentChatModal({
  sessionId,
  path,
  isDirty,
  onEdited,
}: {
  sessionId: string
  path: string
  isDirty: boolean
  onEdited: () => void
}) {
  const [open, setOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  // The AI content editor is admin-only; hide the entry point for managers.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((d: { role?: string }) => { if (!cancelled && d.role === 'admin') setIsAdmin(true) })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  if (!isAdmin) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all hover:bg-brand-cyan-dark"
      >
        Edit with AI
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button aria-label="Close" onClick={() => setOpen(false)} className="flex-1 bg-brand-navy/40" />
          <div className="w-full max-w-[460px] h-full bg-surface-page shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 flex-shrink-0 border-b border-border-default bg-surface-card">
              <span className="text-sm font-heading font-semibold text-brand-navy">Edit content with AI</span>
              <button
                onClick={() => setOpen(false)}
                className="text-text-muted hover:text-brand-navy text-lg leading-none transition-colors"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <ContentChat key={path} sessionId={sessionId} path={path} isDirty={isDirty} onEdited={onEdited} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
