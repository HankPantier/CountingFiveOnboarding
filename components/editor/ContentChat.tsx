'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { DefaultChatTransport, type TextUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import { summarizeEditRun } from '@/lib/editor/edit-run-summary'
import AiIssueNotice from '@/components/ui/AiIssueNotice'

export default function ContentChat({
  sessionId,
  path,
  isDirty,
  onEdited,
  onSave,
}: {
  sessionId: string
  path: string
  isDirty: boolean
  onEdited: () => void
  onSave: () => void
}) {
  const [input, setInput] = useState('')
  const [lastSent, setLastSent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/edit/${sessionId}/chat`, body: { path } }),
    [sessionId, path]
  )

  const { messages, sendMessage, status, error } = useChat({ transport })
  const isLoading = status === 'submitted' || status === 'streaming'

  // Honest summary of the most recent assistant turn: how many edits actually
  // committed, how many failed, and whether the run was truncated by the step
  // cap (so we never imply a full save when it only partially applied).
  const runSummary = useMemo(() => {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return null
    const finishReason = (last as { metadata?: { finishReason?: string } }).metadata?.finishReason
    return summarizeEditRun(last.parts as { type?: string; output?: unknown; result?: unknown }[], finishReason)
  }, [messages])

  // After each completed exchange the agent may have committed a new version of
  // the file — reload it in the editor so the cached content + sha are fresh,
  // and refresh publish status (a firm-wide contact change edits brand.json,
  // not the open page).
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
    if (!text || isLoading || isDirty) return
    setInput('')
    setLastSent(text)
    sendMessage({ text })
  }

  const retryLast = () => {
    if (!lastSent || isLoading || isDirty) return
    sendMessage({ text: lastSent })
  }

  return (
    <div className="flex flex-col h-full border border-border-default rounded-lg bg-surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-default bg-surface-subtle">
        <h2 className="text-sm font-heading font-semibold text-text-primary">Content Assistant</h2>
        <p className="text-xs text-text-muted font-body mt-0.5 truncate">{path}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px]">
        {messages.length === 0 && (
          <p className="text-text-muted font-body text-sm italic">
            Try: &ldquo;Tighten the intro&rdquo;, &ldquo;Move the image to the other side&rdquo;, &ldquo;Add an FAQ about audit representation&rdquo;, or &ldquo;Update the phone number.&rdquo;
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
        {isLoading && <p className="text-text-muted font-body text-xs italic">Editing…</p>}
        <div ref={bottomRef} />
      </div>

      {error && <AiIssueNotice message={error.message} onRetry={lastSent ? retryLast : undefined} />}

      {status === 'ready' && !error && runSummary && (runSummary.failed > 0 || runSummary.incomplete) && (
        <p className="px-4 py-2 text-xs text-warning-strong font-body bg-warning/10 border-t border-warning/30">
          {runSummary.applied > 0
            ? `Applied ${runSummary.applied} change${runSummary.applied === 1 ? '' : 's'}`
            : 'No changes were applied'}
          {runSummary.failed > 0 && `, ${runSummary.failed} failed`}
          {runSummary.incomplete && ', and the run stopped early'}. Review the page and send again to finish the rest.
        </p>
      )}

      {status === 'ready' && !error && runSummary && runSummary.failed === 0 && !runSummary.incomplete && runSummary.applied > 0 && (
        <p className="px-4 py-2 text-xs text-success font-body bg-success/10 border-t border-success/30">
          ✓ Saved {runSummary.applied} change{runSummary.applied === 1 ? '' : 's'} to draft — Publish when you&rsquo;re ready to push it live.
        </p>
      )}

      {isDirty && (
        <div className="px-4 py-2 text-xs text-warning-strong bg-warning/10 font-body border-t border-warning/30 flex items-center justify-between gap-2">
          <span>You have unsaved edits — the assistant works on the saved draft.</span>
          <button
            onClick={onSave}
            className="rounded-pill border border-warning-strong/40 px-2.5 py-0.5 font-heading font-semibold text-warning-strong whitespace-nowrap transition-colors hover:bg-warning/10"
          >
            Save now
          </button>
        </div>
      )}

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
          placeholder="Describe the change…"
          disabled={isDirty}
          className="flex-1 resize-y border border-border-default rounded-2xl px-3.5 py-1.5 text-xs font-body bg-surface-card focus:outline-none focus:border-brand-cyan disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || isDirty || !input.trim()}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  )
}
