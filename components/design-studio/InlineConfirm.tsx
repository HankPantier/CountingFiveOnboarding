'use client'

import { useState } from 'react'
import { FOCUS, SECONDARY_BTN_SM } from './styles'

// Two-step inline confirm for destructive actions — no browser dialog. The
// first click arms it; the row then shows the prompt with Confirm / Cancel.
export default function InlineConfirm({
  label,
  prompt,
  confirmLabel,
  busy,
  onConfirm,
}: {
  label: string
  prompt: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => Promise<void>
}) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} disabled={busy} className={`${SECONDARY_BTN_SM} hover:border-error/40 hover:text-error`}>
        {label}
      </button>
    )
  }
  return (
    <span role="group" aria-label={prompt} className="inline-flex items-center gap-1.5 rounded-pill bg-error/10 py-0.5 pl-2.5 pr-1">
      <span className="font-body text-[11px] text-error">{prompt}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setArmed(false)
          void onConfirm()
        }}
        className={`rounded-pill bg-error px-2.5 py-0.5 font-heading text-[11px] font-semibold text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS}`}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className={`rounded-pill px-2 py-0.5 font-heading text-[11px] font-semibold text-text-secondary hover:text-brand-navy ${FOCUS}`}
      >
        Cancel
      </button>
    </span>
  )
}
