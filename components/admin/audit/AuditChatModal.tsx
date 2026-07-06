'use client'
import { useState } from 'react'
import AuditChat from '@/components/admin/audit/AuditChat'
import ChatDrawer from '@/components/ui/ChatDrawer'

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
        <ChatDrawer title="Edit report with AI" onClose={() => setOpen(false)}>
          <AuditChat auditId={auditId} initialMessages={initialMessages} />
        </ChatDrawer>
      )}
    </>
  )
}
