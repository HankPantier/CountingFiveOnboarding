'use client'
import { useState } from 'react'
import ContentChat from '@/components/editor/ContentChat'
import ChatDrawer from '@/components/ui/ChatDrawer'

export default function ContentChatModal({
  sessionId,
  path,
  isDirty,
  allowed,
  onEdited,
  onSave,
}: {
  sessionId: string
  path: string
  isDirty: boolean
  // The per-page AI editor is reachable by admins and Site Owners; the caller
  // (EditorShell) resolves this from the viewer's role/capabilities. The route
  // enforces the same gate server-side.
  allowed: boolean
  onEdited: () => void
  onSave: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!allowed) return null

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
