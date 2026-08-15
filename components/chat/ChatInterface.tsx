'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import Image from 'next/image'
import Link from 'next/link'
import MessageBubble from './MessageBubble'
import FileUploadButton from './FileUploadButton'
import type { Database } from '@/types/database'

type Session = Database['public']['Tables']['sessions']['Row']

const PHASE_LABELS: Record<number, string> = {
  0: 'Getting started',
  1: 'Contact info',
  2: 'Just a moment…',
  3: 'Reviewing your details',
  4: 'A few questions',
  5: 'Upload files',
  6: 'Almost done',
  7: 'Complete',
}

const STAFF_PHASE_LABELS: Record<number, string> = {
  0: 'Staff · Phase 0',
  1: 'Staff · Phase 1',
  2: 'Staff · Phase 2',
  3: 'Staff · Phase 3',
  4: 'Staff · Phase 4',
  5: 'Staff · Phase 5',
  6: 'Staff · Phase 6',
  7: 'Staff · Phase 7',
}

export default function ChatInterface({
  sessionId,
  initialSession,
  initialMessages,
  initialIsStaffMode = false,
}: {
  sessionId: string
  initialSession: Session
  initialMessages: { role: string; content: string }[]
  initialIsStaffMode?: boolean
}) {
  const [input, setInput] = useState('')
  const [currentPhase, setCurrentPhase] = useState(initialSession.current_phase)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isStaffMode, setIsStaffMode] = useState(initialIsStaffMode)
  const [staffPanelOpen, setStaffPanelOpen] = useState(false)
  const [staffNote, setStaffNote] = useState('')
  const [staffSubmitting, setStaffSubmitting] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  // Last text the rep sent, so Retry / Reset can resend without re-typing.
  const [lastSent, setLastSent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { sessionId } }),
    [sessionId]
  )

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: initialMessages.map((m, i) => ({
      id: `init-${i}`,
      role: m.role as 'user' | 'assistant',
      parts: [{ type: 'text' as const, text: m.content }],
    })),
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // useChat owns `error`; tracking the dismissed error (instead of a boolean +
  // effect reset) lets a fresh error re-show the banner without setting state
  // inside an effect. The banner shows whenever the current error isn't the
  // one the user dismissed.
  const [dismissedError, setDismissedError] = useState<typeof error>(undefined)
  const showError = !!error && error !== dismissedError

  // A stranded processing lock surfaces as a 429 "Already processing" with an
  // empty message — show a calmer "still finishing" note for that, and never a
  // bare dash for anything else.
  const rawErrorMsg = error?.message ?? ''
  const isBusyError = /already processing|processing/i.test(rawErrorMsg)
  const errorText = isBusyError
    ? 'The assistant is still finishing the last reply — give it a moment, then Retry.'
    : `${rawErrorMsg || 'Something interrupted the last reply.'} — please try again.`

  const resend = () => {
    const text = lastSent
    if (!text || isLoading) return
    setDismissedError(error)
    sendMessage({ text })
  }

  const resetAndRetry = async () => {
    if (resetting || isLoading) return
    setResetting(true)
    try {
      await fetch(`/api/sessions/${sessionId}/unstick`, { method: 'POST' })
    } catch { /* best effort — resend still self-heals via the 3-min reclaim */ }
    setResetting(false)
    resend()
  }

  // Admin detection runs on mount. Non-admin visitors quietly get { isAdmin: false }
  // (no console errors), so the staff toggle simply never renders for them.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((data: { isAdmin?: boolean }) => {
        if (!cancelled && data.isAdmin) setIsAdmin(true)
      })
      .catch(() => { /* unauthenticated; ignore */ })
    return () => { cancelled = true }
  }, [])

  // Refresh phase after each assistant exchange
  useEffect(() => {
    if (status !== 'ready' || messages.length === 0) return
    fetch(`/api/sessions/${sessionId}/phase`)
      .then(r => r.json())
      .then((data: { phase?: number }) => { if (typeof data.phase === 'number') setCurrentPhase(data.phase) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const didTrigger = useRef(false)
  useEffect(() => {
    if (initialMessages.length > 0) return
    if (isLoading) return
    if (messages.length > 0) return
    if (didTrigger.current) return
    didTrigger.current = true
    sendMessage({ text: '__init__' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    setLastSent(text)
    sendMessage({ text })
  }

  const handleStaffSubmit = async () => {
    setStaffSubmitting(true)
    setStaffError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/staff-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(staffNote.trim() ? { note: staffNote.trim() } : {}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setIsStaffMode(true)
      setStaffPanelOpen(false)
      setStaffNote('')
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'Failed to switch')
    } finally {
      setStaffSubmitting(false)
    }
  }

  const visibleMessages = messages.filter(m => {
    const textPart = m.parts.find((p): p is TextUIPart => p.type === 'text')
    return textPart?.text !== '__init__'
  })

  const totalPhases = 7
  const progressPct = Math.round((currentPhase / totalPhases) * 100)
  const isComplete = currentPhase >= totalPhases
  const phaseLabel = isStaffMode
    ? STAFF_PHASE_LABELS[currentPhase] ?? ''
    : PHASE_LABELS[currentPhase] ?? ''
  // Staff labels already read "Staff · Phase N"; only client labels get the
  // "Step X of 7 · …" framing so the client always sees where they are.
  const stepLabel =
    isStaffMode || currentPhase < 1
      ? phaseLabel
      : `Step ${currentPhase} of ${totalPhases} · ${phaseLabel}`
  const showStaffButton = isAdmin && !isStaffMode && currentPhase <= 1

  return (
    <div className="flex flex-col h-full bg-surface-page">
      <header className="bg-surface-card border-b border-border-default flex-shrink-0">
        <div className="h-16 flex items-center justify-between px-6">
          <Image
            src="/logo.png"
            alt="Revaltus"
            height={43}
            width={240}
            className="h-[43px] w-auto"
            priority
          />
          <div className="flex items-center gap-3">
            {isStaffMode && (
              <span className="bg-brand-cyan/20 border border-brand-cyan/40 text-brand-cyan-dark text-[11px] font-heading font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill">
                Staff mode
              </span>
            )}
            {showStaffButton && (
              <button
                type="button"
                onClick={() => setStaffPanelOpen(true)}
                className="text-text-secondary hover:text-text-primary text-xs font-body underline-offset-2 hover:underline transition"
              >
                I&apos;m staff — switch mode
              </button>
            )}
            {currentPhase > 0 && (
              <span className="text-text-secondary text-xs font-body hidden sm:block">
                {stepLabel}
              </span>
            )}
          </div>
        </div>
        {currentPhase > 0 && (
          <div className="h-0.5 bg-border-default">
            <div
              className="h-full bg-brand-cyan transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </header>

      {staffPanelOpen && (
        <div className="bg-surface-card border-b border-border-default px-4 py-4 flex-shrink-0">
          <div className="max-w-2xl mx-auto">
            <p className="text-sm font-heading font-semibold text-brand-navy">
              Switch this session to staff mode
            </p>
            <p id="staff-note-help" className="text-text-muted text-xs font-body mt-1">
              Optional: short note on why staff is filling this in (kept in the session, not shown to the client).
            </p>
            <textarea
              value={staffNote}
              aria-describedby="staff-note-help"
              onChange={e => setStaffNote(e.target.value)}
              disabled={staffSubmitting}
              maxLength={1000}
              rows={2}
              placeholder="e.g. Client emailed answers; entering on their behalf."
              className="mt-2 w-full border border-border-default rounded-2xl px-3 py-2 text-sm font-body bg-surface-page focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 disabled:opacity-50 transition-all duration-150"
            />
            {staffError && (
              <p className="text-error text-xs font-body mt-2">{staffError}</p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setStaffPanelOpen(false); setStaffError(null) }}
                disabled={staffSubmitting}
                className="text-text-muted hover:text-text-primary text-sm font-body px-3 py-2 rounded-pill transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStaffSubmit}
                disabled={staffSubmitting}
                className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all duration-150 hover:bg-brand-cyan-dark active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {staffSubmitting ? 'Switching…' : 'Switch to staff mode'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showError && (
        <div
          role="alert"
          className="bg-error/10 border-b border-error/20 px-4 py-2 text-sm font-body text-error flex-shrink-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
        >
          <span>{errorText}</span>
          <div className="flex items-center gap-4 shrink-0">
            {lastSent && (
              <button
                type="button"
                onClick={resend}
                disabled={isLoading || resetting}
                className="text-xs font-heading font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-50 disabled:no-underline"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={resetAndRetry}
              disabled={isLoading || resetting}
              className="text-xs font-heading font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-50 disabled:no-underline"
            >
              {resetting ? 'Resetting…' : 'Reset & retry'}
            </button>
            <button
              type="button"
              onClick={() => setDismissedError(error)}
              className="text-xs font-heading font-semibold underline underline-offset-2 hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-2xl mx-auto w-full">
        <div className="space-y-4">
          {visibleMessages.map(m => (
            <MessageBubble
              key={m.id}
              message={m}
              isNew={!m.id.startsWith('init-')}
            />
          ))}

          {isLoading && (
            <div className="flex justify-start motion-safe:animate-msg-in">
              <div className="bg-surface-card border border-border-default shadow-subtle rounded-2xl px-4 py-3 flex items-center gap-3">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-brand-cyan motion-safe:animate-dot-bounce"
                    style={{ animationDelay: `${i * 160}ms` }}
                  />
                ))}
                <span className="text-text-muted text-xs font-body">Thinking…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border-default bg-surface-card px-4 py-4 flex-shrink-0">
        {isComplete ? (
          isStaffMode ? (
            <div className="max-w-2xl mx-auto text-center py-2 flex flex-col items-center gap-3">
              <div>
                <p className="text-base font-heading font-semibold text-brand-navy">
                  Onboarding complete — the profile is captured and the session is marked ready.
                </p>
                <p className="text-text-secondary text-sm font-body mt-1">
                  Review it, add any remaining files, and approve it for content generation on the session page.
                </p>
              </div>
              <Link
                href={`/admin/sessions/${sessionId}`}
                className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill shadow-cyan-base transition-all duration-150 hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow active:scale-95"
              >
                Open session →
              </Link>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto text-center py-2">
              <p className="text-base font-heading font-semibold text-brand-navy">
                You&apos;re all set — onboarding complete.
              </p>
              <p className="text-text-secondary text-sm font-body mt-1">
                Thanks for walking through this. Our team will be in touch shortly to begin your project.
              </p>
            </div>
          )
        ) : (
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          {currentPhase >= 5 && (
            <div>
              <FileUploadButton
                sessionId={sessionId}
                onUploadComplete={(fileName) => {
                  sendMessage({ text: `[File uploaded: ${fileName}]` })
                }}
              />
              <p className="text-text-muted text-xs font-body mt-1 px-1">
                JPG, PNG, PDF · Max 300 MB
              </p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isLoading}
              placeholder="Type your reply…"
              className="flex-1 border border-border-default rounded-pill px-4 py-3 text-sm font-body bg-surface-page focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 disabled:opacity-50 transition-all duration-150"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all duration-150 hover:bg-brand-cyan-dark active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        </div>
        )}
      </div>
    </div>
  )
}
