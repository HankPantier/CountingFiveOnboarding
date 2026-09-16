'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Proactive, app-wide banner shown across the admin shell when the account's
// Claude API credits have run out — a credit outage takes down every AI feature
// at once, so one banner beats a stream of per-action "hit an error" failures.
// Rendered only when the server determined the outage is active (getAiCreditStatus).
// Dismiss is in-memory (hides for this page view; re-appears on reload while the
// outage persists). Admins get a "topped up" action that clears the flag globally.
export default function AiCreditBanner({ isAdmin }: { isAdmin: boolean }) {
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  if (hidden) return null

  const markResolved = async () => {
    setBusy(true)
    try {
      await fetch('/api/admin/ai-status/clear', { method: 'POST' })
      setHidden(true)
      router.refresh()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/10 px-6 py-2.5 font-body text-sm text-warning-strong"
    >
      <span className="flex-1 min-w-0">
        <span className="font-heading font-semibold">AI features are paused</span> — the account&apos;s
        Claude API credits have run out. Add credits in the Anthropic console to restore content
        generation, AI editing, and audits. Retrying won&apos;t help until then.
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {isAdmin && (
          <button
            onClick={markResolved}
            disabled={busy}
            className="rounded-pill bg-brand-cyan px-3 py-1 font-heading text-xs font-semibold text-text-inverse transition-colors hover:bg-brand-cyan-dark disabled:opacity-50"
          >
            {busy ? 'Clearing…' : "I've added credits"}
          </button>
        )}
        <button
          onClick={() => setHidden(true)}
          aria-label="Dismiss for now"
          className="rounded-pill px-2 py-1 font-heading text-xs font-semibold text-warning-strong transition-colors hover:bg-warning/20"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
