'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'

type GenStatus = 'generating' | 'complete' | 'error'
const STRUCTURAL_TOOLS = ['tool-delete_page', 'tool-create_page', 'tool-set_nav']

// Site-structure assistant — drives the site-assistant chat route (create /
// delete pages, edit nav). On a committed structural change it calls onEdited()
// so the parent refreshes the file tree + publish status. New pages generate
// their body asynchronously, so it polls the shared create-page status endpoint
// and shows per-page progress until each draft lands.
export default function SiteAssistantChat({
  sessionId,
  onEdited,
}: {
  sessionId: string
  onEdited: () => void
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/edit/${sessionId}/site-assistant/chat` }),
    [sessionId]
  )

  const { messages, sendMessage, status, error } = useChat({ transport })
  const isLoading = status === 'submitted' || status === 'streaming'

  const [gens, setGens] = useState<Record<string, { url: string; status: GenStatus }>>({})
  const pollingRef = useRef<Set<string>>(new Set())

  // Did the latest assistant turn commit a structural change? Only refresh the
  // parent tree/status on a real edit (not on read-only list_site_pages turns).
  const committed = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!last) return false
    return last.parts.some((p) => {
      const tp = p as { type?: string; output?: unknown }
      if (!tp.type || !STRUCTURAL_TOOLS.includes(tp.type)) return false
      const out = tp.output as { success?: boolean; error?: string } | undefined
      return !!out && !out.error && out.success !== false
    })
  }, [messages])

  useEffect(() => {
    if (status === 'ready' && committed) onEdited()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Watch for create_page tool results carrying a generationId and poll each to
  // completion, surfacing progress and refreshing the parent when a draft lands.
  useEffect(() => {
    const poll = async (genId: string, url: string) => {
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const res = await fetch(`/api/edit/${sessionId}/create-page/${genId}`)
          if (!res.ok) continue
          const data = (await res.json()) as { generation?: { status: string } }
          const s = data.generation?.status
          if (s === 'complete') {
            setGens((g) => ({ ...g, [genId]: { url, status: 'complete' } }))
            onEdited()
            return
          }
          if (s === 'error') {
            setGens((g) => ({ ...g, [genId]: { url, status: 'error' } }))
            return
          }
        } catch {
          /* transient — keep polling */
        }
      }
      setGens((g) => ({ ...g, [genId]: { url, status: 'error' } }))
    }

    for (const m of messages) {
      if (m.role !== 'assistant') continue
      for (const p of m.parts) {
        const tp = p as { type?: string; output?: { generationId?: string; url?: string } }
        if (tp.type !== 'tool-create_page' || !tp.output?.generationId) continue
        const genId = tp.output.generationId
        if (pollingRef.current.has(genId)) continue
        pollingRef.current.add(genId)
        const url = tp.output.url ?? ''
        setGens((g) => ({ ...g, [genId]: { url, status: 'generating' } }))
        void poll(genId, url)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

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

  const genList = Object.entries(gens)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-card">
      <div className="min-h-[300px] flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="font-body text-sm italic text-text-muted">
            I manage this site&rsquo;s pages and navigation. Try: &ldquo;Remove the Restaurants and
            Agriculture pages and add Veterinarians and Real Estate Professionals.&rdquo; I&rsquo;ll
            walk through each change one at a time and confirm before I make it.
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
        {isLoading && <p className="font-body text-xs italic text-text-muted">Working…</p>}
        <div ref={bottomRef} />
      </div>

      {genList.length > 0 && (
        <div className="space-y-1 border-t border-border-default bg-surface-subtle px-4 py-2">
          {genList.map(([genId, g]) => (
            <p key={genId} className="font-body text-xs text-text-secondary">
              {g.status === 'generating' && <>✍️ Writing <strong>{g.url}</strong>…</>}
              {g.status === 'complete' && <span className="text-success">✓ <strong>{g.url}</strong> draft ready</span>}
              {g.status === 'error' && (
                <span className="text-error">
                  ⚠ <strong>{g.url}</strong> — AI draft didn&rsquo;t finish (the blank page was kept)
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      {error && <p className="bg-error/10 px-4 py-2 font-body text-sm text-error">{error.message}</p>}

      {status === 'ready' && committed && (
        <p className="border-t border-success/30 bg-success/10 px-4 py-2 font-body text-xs text-success">
          ✓ Saved to draft — review in Changes, then Publish to push it live.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-start gap-2 border-t border-border-default p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          rows={2}
          placeholder="Describe the structural change…"
          className="flex-1 resize-y rounded-2xl border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs focus:border-brand-cyan focus:outline-none"
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
