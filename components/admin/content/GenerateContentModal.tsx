'use client'
import { useState } from 'react'
import GenerateContentChat from '@/components/admin/content/GenerateContentChat'
import ChatDrawer from '@/components/ui/ChatDrawer'

export default function GenerateContentModal({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
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
