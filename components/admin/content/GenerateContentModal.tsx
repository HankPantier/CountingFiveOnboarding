'use client'
import { useState } from 'react'
import GenerateContentChat from '@/components/admin/content/GenerateContentChat'
import ChatDrawer from '@/components/ui/ChatDrawer'

export default function GenerateContentModal({
  sessionId,
  contentComplete = false,
}: {
  sessionId: string
  contentComplete?: boolean
}) {
  const [open, setOpen] = useState(false)

  const handleOpen = () => {
    if (
      contentComplete &&
      !window.confirm(
        "This client's content is already marked COMPLETE. Open the Content Assistant anyway?",
      )
    ) {
      return
    }
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill border border-border-default text-text-secondary transition-all hover:border-brand-cyan hover:text-brand-navy"
      >
        Generate Content
      </button>

      {open && (
        <ChatDrawer title="Generate Content" onClose={() => setOpen(false)}>
          <GenerateContentChat sessionId={sessionId} />
        </ChatDrawer>
      )}
    </>
  )
}
