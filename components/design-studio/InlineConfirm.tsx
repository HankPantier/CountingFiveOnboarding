'use client'

import { useEffect, useRef, useState } from 'react'
import { FOCUS, SECONDARY_BTN_SM } from './styles'

// Two-step inline confirm (no browser dialog). The first click arms it; the
// row then shows the prompt with Confirm / Cancel. Keyboard users land on
// Confirm when it arms and back on the trigger when it disarms, instead of
// focus falling to <body> when the focused trigger unmounts. `tone` =
// 'destructive' (default: error colours) or 'neutral' (brand colours).
export default function InlineConfirm({
  label,
  prompt,
  confirmLabel,
  busy,
  onConfirm,
  tone = 'destructive',
}: {
  label: string
  prompt: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => Promise<void>
  tone?: 'destructive' | 'neutral'
}) {
  const [armed, setArmed] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Only move focus after an interaction (never on first mount).
  const interacted = useRef(false)

  useEffect(() => {
    if (!interacted.current) return
    if (armed) confirmRef.current?.focus()
    else triggerRef.current?.focus()
  }, [armed])

  const setArmedFromUser = (next: boolean) => {
    interacted.current = true
    setArmed(next)
  }

  const destructive = tone === 'destructive'
  if (!armed) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setArmedFromUser(true)}
        disabled={busy}
        className={`${SECONDARY_BTN_SM} ${destructive ? 'hover:border-error/40 hover:text-error' : ''}`}
      >
        {label}
      </button>
    )
  }
  return (
    <span
      role="group"
      aria-label={prompt}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setArmedFromUser(false)
      }}
      className={`inline-flex items-center gap-1.5 rounded-pill py-0.5 pl-2.5 pr-1 ${destructive ? 'bg-error/10' : 'bg-brand-cyan/10'}`}
    >
      <span className={`font-body text-[11px] ${destructive ? 'text-error' : 'text-brand-navy'}`}>{prompt}</span>
      <button
        ref={confirmRef}
        type="button"
        disabled={busy}
        onClick={() => {
          setArmedFromUser(false)
          void onConfirm()
        }}
        className={`rounded-pill px-2.5 py-0.5 font-heading text-[11px] font-semibold text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50 ${
          destructive ? 'bg-error' : 'bg-brand-cyan'
        } ${FOCUS}`}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmedFromUser(false)}
        className={`rounded-pill px-2 py-0.5 font-heading text-[11px] font-semibold text-text-secondary hover:text-brand-navy ${FOCUS}`}
      >
        Cancel
      </button>
    </span>
  )
}
