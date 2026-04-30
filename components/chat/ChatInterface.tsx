'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import Image from 'next/image'
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

export default function ChatInterface({
  sessionId,
  initialSession,
  initialMessages,
}: {
  sessionId: string
  initialSession: Session
  initialMessages: { role: string; content: string }[]
}) {
  const [input, setInput] = useState('')
  const [currentPhase, setCurrentPhase] = useState(initialSession.current_phase)
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
    sendMessage({ text })
  }

  const visibleMessages = messages.filter(m => {
    const textPart = m.parts.find((p): p is TextUIPart => p.type === 'text')
    return textPart?.text !== '__init__'
  })

  const totalPhases = 7
  const progressPct = Math.round((currentPhase / totalPhases) * 100)
  const phaseLabel = PHASE_LABELS[currentPhase] ?? ''

  return (
    <div className="flex flex-col h-screen bg-surface-page">
      <header className="bg-brand-navy flex-shrink-0">
        <div className="h-16 flex items-center justify-between px-6">
          <Image
            src="/logo-white.png"
            alt="CountingFive"
            height={32}
            width={180}
            className="h-8 w-auto"
            priority
          />
          {currentPhase > 0 && (
            <span className="text-white/60 text-xs font-body hidden sm:block">
              {phaseLabel}
            </span>
          )}
        </div>
        {currentPhase > 0 && (
          <div className="h-0.5 bg-white/10">
            <div
              className="h-full bg-brand-cyan transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </header>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm font-body text-red-700 text-center flex-shrink-0">
          {error.message} — please try again.
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
                    className="w-1.5 h-1.5 rounded-full bg-text-muted motion-safe:animate-dot-bounce"
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
              className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all duration-150 hover:bg-brand-navy active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
