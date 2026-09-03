'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import AiIssueNotice from '@/components/ui/AiIssueNotice'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="mt-1.5 text-[11px] font-heading font-semibold text-text-muted hover:text-brand-cyan transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function GenerateContentChat({ sessionId }: { sessionId: string }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/content-assistant/${sessionId}/chat` }),
    [sessionId]
  )

  const { messages, sendMessage, status, error } = useChat({ transport })

  const isLoading = status === 'submitted' || status === 'streaming'

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
        <h2 className="text-sm font-heading font-semibold text-text-primary">Content Assistant</h2>
        <p className="text-xs text-text-muted font-body mt-0.5">
          Ask for any on-brand copy — bios, social posts, announcements. Grounded in this client&rsquo;s MBP.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px]">
        {messages.length === 0 && (
          <p className="text-text-muted font-body text-sm italic">
            Try: &ldquo;Generate a LinkedIn bio for …&rdquo; or &ldquo;Draft a social post about our new tax-planning service.&rdquo;
          </p>
        )}
        {messages.map(m => {
          const text = m.parts
            .filter((p): p is TextUIPart => p.type === 'text')
            .map(p => p.text)
            .join('')
          if (!text) return null
          const isUser = m.role === 'user'
          return (
            <div key={m.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
              <div
                className={[
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm font-body whitespace-pre-wrap',
                  isUser
                    ? 'bg-brand-navy text-text-inverse'
                    : 'bg-surface-subtle text-text-primary border border-border-default',
                ].join(' ')}
              >
                {text}
              </div>
              {!isUser && <CopyButton text={text} />}
            </div>
          )
        })}
        {isLoading && <p className="text-text-muted font-body text-xs italic">Thinking…</p>}
        <div ref={bottomRef} />
      </div>

      {error && <AiIssueNotice message={error.message} />}

      <form onSubmit={handleSubmit} className="flex items-start gap-2 p-3 border-t border-border-default">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          rows={2}
          placeholder="Generate a LinkedIn bio for…"
          className="flex-1 resize-y border border-border-default rounded-2xl px-3.5 py-1.5 text-xs font-body bg-surface-card focus:outline-none focus:border-brand-cyan"
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
