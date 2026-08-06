'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'

// AI theme assistant — mirrors ContentChat but drives the theme chat route and
// its palette/token/override tools. On a successful theme commit it calls
// onEdited() so the parent refetches sources and the preview updates live.
export default function ThemeChat({
  sessionId,
  onEdited,
}: {
  sessionId: string
  onEdited: () => void
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/edit/${sessionId}/theme/chat` }),
    [sessionId]
  )

  const { messages, sendMessage, status, error } = useChat({ transport })
  const isLoading = status === 'submitted' || status === 'streaming'

  // Did the latest assistant turn actually commit a theme change? Scan its tool
  // parts for a successful output so we only confirm (and refetch) on a real edit.
  const committed = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!last) return false
    const TOOLS = ['tool-set_palette', 'tool-set_tokens', 'tool-set_block_override']
    return last.parts.some((p) => {
      const tp = p as { type?: string; output?: unknown; result?: unknown }
      if (!tp.type || !TOOLS.includes(tp.type)) return false
      const out = (tp.output ?? tp.result) as { success?: boolean; error?: string } | undefined
      return !!out && !out.error && out.success !== false
    })
  }, [messages])

  // After each completed exchange, refetch the theme sources so the preview
  // reflects whatever the agent committed.
  useEffect(() => {
    if (status === 'ready' && messages.length > 0) onEdited()
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
    <div className="flex h-full flex-col overflow-hidden border-l border-border-default bg-surface-card">
      <div className="border-b border-border-default bg-surface-subtle px-4 py-3">
        <h2 className="font-heading text-sm font-semibold text-text-primary">Theme Assistant</h2>
        <p className="mt-0.5 font-body text-xs text-text-muted">Colours, roundness, spacing &amp; per-block CSS</p>
      </div>

      <div className="min-h-[300px] flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="font-body text-sm italic text-text-muted">
            Try: &ldquo;Warm up the navy a little&rdquo;, &ldquo;Make the buttons pill-shaped&rdquo;,
            &ldquo;Give the site more breathing room&rdquo;, or &ldquo;Make the hero heading bigger.&rdquo;
          </p>
        )}
        {messages.map((m) => {
          const text = m.parts
            .filter((p): p is TextUIPart => p.type === 'text')
            .map((p) => p.text)
            .join('')
          if (!text) return null
          return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 font-body text-sm',
                  m.role === 'user'
                    ? 'bg-brand-navy text-text-inverse'
                    : 'border border-border-default bg-surface-subtle text-text-primary',
                ].join(' ')}
              >
                {text}
              </div>
            </div>
          )
        })}
        {isLoading && <p className="font-body text-xs italic text-text-muted">Updating the theme…</p>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="bg-error/10 px-4 py-2 font-body text-sm text-error">{error.message}</p>}

      {status === 'ready' && committed && (
        <p className="border-t border-success/30 bg-success/10 px-4 py-2 font-body text-xs text-success">
          ✓ Saved to draft — review in the preview, then Publish to push it live.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border-default p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe the theme change…"
          className="flex-1 rounded-pill border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs focus:border-brand-cyan focus:outline-none"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
