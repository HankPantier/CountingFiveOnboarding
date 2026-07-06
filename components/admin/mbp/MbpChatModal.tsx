'use client'
import { useState } from 'react'
import MbpChat from '@/components/admin/mbp/MbpChat'
import ChatDrawer from '@/components/ui/ChatDrawer'

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
        className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark"
      >
        Edit with AI
      </button>

      {open && (
        <ChatDrawer title="Edit MBP with AI" onClose={() => setOpen(false)}>
          <MbpChat sessionId={sessionId} initialMessages={initialMessages} />
        </ChatDrawer>
      )}
    </>
  )
}
