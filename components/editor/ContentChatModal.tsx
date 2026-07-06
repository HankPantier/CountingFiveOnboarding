'use client'
import { useState, useEffect } from 'react'
import ContentChat from '@/components/editor/ContentChat'
import ChatDrawer from '@/components/ui/ChatDrawer'

export default function ContentChatModal({
  sessionId,
  path,
  isDirty,
  onEdited,
  onSave,
}: {
  sessionId: string
  path: string
  isDirty: boolean
  onEdited: () => void
  onSave: () => void
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
        className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark"
      >
        Edit with AI
      </button>

      {open && (
        <ChatDrawer title="Edit content with AI" onClose={() => setOpen(false)}>
          <ContentChat key={path} sessionId={sessionId} path={path} isDirty={isDirty} onEdited={onEdited} onSave={onSave} />
        </ChatDrawer>
      )}
    </>
  )
}
