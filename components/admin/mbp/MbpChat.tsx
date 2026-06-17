'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import { useRouter } from 'next/navigation'

export default function MbpChat({
  sessionId,
  initialMessages,
}: {
  sessionId: string
  initialMessages: { role: string; content: string }[]
}) {
  const [input, setInput] = useState('')
  const router = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/mbp/${sessionId}/chat` }),
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

  // After each completed exchange, refresh the server component so the
  // document + completeness panel reflect any update_mbp tool writes.
  useEffect(() => {
    if (status === 'ready' && messages.length > 0) router.refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    sendMessage({ text })
  }

  return (
    <div className="flex flex-col h-full border border-border-default rounded-lg bg-surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-default bg-surface-subtle">
        <h2 className="text-sm font-heading font-semibold text-text-primary">MBP Edit Assistant</h2>
        <p className="text-xs text-text-muted font-body mt-0.5">
          Ask to fill or correct any field — changes apply to the profile.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px]">
        {messages.length === 0 && (
          <p className="text-text-muted font-body text-sm italic">
            Try: &ldquo;Set the tagline to …&rdquo; or &ldquo;Fill in the missing brand voice example.&rdquo;
          </p>
        )}
        {messages.map(m => {
          const text = m.parts
            .filter((p): p is TextUIPart => p.type === 'text')
            .map(p => p.text)
            .join('')
          if (!text) return null
          return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm font-body whitespace-pre-wrap',
                  m.role === 'user'
                    ? 'bg-brand-navy text-text-inverse'
                    : 'bg-surface-subtle text-text-primary border border-border-default',
                ].join(' ')}
              >
                {text}
              </div>
            </div>
          )
        })}
        {isLoading && (
          <p className="text-text-muted font-body text-xs italic">Thinking…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 py-2 text-sm text-error bg-error/10 font-body">{error.message}</p>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3 border-t border-border-default">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Edit the MBP…"
          className="flex-1 border border-border-default rounded-pill px-3.5 py-1.5 text-xs font-body bg-surface-card focus:outline-none focus:border-brand-cyan"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  )
}
