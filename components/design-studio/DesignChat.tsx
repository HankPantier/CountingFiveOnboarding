'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DefaultChatTransport } from 'ai'
import { useChat } from '@ai-sdk/react'
import AiIssueNotice from '@/components/ui/AiIssueNotice'
import { messageText } from '@/lib/design/chat-history'
import { CHAT_TEXT_MAX, MAX_ATTACHMENTS_PER_MESSAGE, type ChatAttachmentDto, type DesignChatMessage } from '@/lib/design/chat-types'
import { chatBlocks, chatRequestErrorText, lastAssistant, messageCommitted, restoresComposer, type ChatBlock } from '@/lib/design/chat-ui'
import { SIGNED_VIEW_STALE_MS, isNearBottom } from '@/lib/design/studio-ui'
import AnnotateCanvas, { type AnnotateSource } from './AnnotateCanvas'
import InlineConfirm from './InlineConfirm'
import { designApi, errorMessage } from './api'
import { FOCUS, PANEL, PRIMARY_BTN, SECONDARY_BTN_SM, TEXTAREA } from './styles'

// A turn the route refused before streaming (PF12). Thrown from the transport's
// fetch so useChat's error carries the server's own text and the status.
class ChatRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ChatRequestError'
  }
}

const chatFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  if (!res.ok) throw new ChatRequestError(chatRequestErrorText(res.status, await res.text().catch(() => '')), res.status)
  return res
}

const TONE: Record<'success' | 'warning' | 'error', string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning-strong',
  error: 'border-error/20 bg-error/10 text-error',
}

// The Design Studio revision chat (P5). History is server-owned
// (design_chat_messages): GET loads it, each send posts only the new message.
// No Stop button: a turn keeps running server-side until it has committed or
// reported, so a stop would only hide the result.
export default function DesignChat({ sessionId, page, onCommitted }: { sessionId: string; page: string; onCommitted: () => void }) {
  const [history, setHistory] = useState<DesignChatMessage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  // Bumped after a stale-URL refresh so ChatBody remounts on the NEW history.
  const [bodyKey, setBodyKey] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await designApi<{ messages: DesignChatMessage[] }>(`/api/edit/${sessionId}/design/chat`)
      setHistory(res.messages)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load the chat'))
    }
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, epoch])

  return (
    <section aria-labelledby="design-chat-heading" className={PANEL}>
      <div>
        <h2 id="design-chat-heading" className="font-heading text-sm font-semibold text-text-primary">
          Revise with AI
        </h2>
        <p className="font-body text-xs text-text-muted">
          Describe a change or attach an annotated screenshot. The assistant previews its work on the real page and saves each change to the draft as a version.
        </p>
      </div>
      {loadError && (
        <p role="alert" className="font-body text-xs text-error">
          {loadError}
        </p>
      )}
      {history ? (
        <ChatBody
          key={`${epoch}-${bodyKey}`}
          sessionId={sessionId}
          page={page}
          initial={history}
          onCommitted={onCommitted}
          onCleared={() => {
            setHistory(null)
            setEpoch((e) => e + 1)
          }}
          onStale={() => {
            void load().then(() => setBodyKey((k) => k + 1))
          }}
        />
      ) : (
        !loadError && <p className="font-body text-xs text-text-muted">Loading the conversation…</p>
      )}
    </section>
  )
}

function ChatBody({
  sessionId,
  page,
  initial,
  onCommitted,
  onCleared,
  onStale,
}: {
  sessionId: string
  page: string
  initial: DesignChatMessage[]
  onCommitted: () => void
  onCleared: () => void
  // The history's signed image URLs have (nearly) expired: reload it.
  onStale: () => void
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<DesignChatMessage>({
        api: `/api/edit/${sessionId}/design/chat`,
        fetch: chatFetch,
        // The server owns the history — send only the new message.
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1]
          const ids: unknown = body?.attachmentIds
          return { body: { text: last ? messageText(last) : '', attachmentIds: Array.isArray(ids) ? ids : [], page } }
        },
      }),
    [sessionId, page]
  )
  const [text, setText] = useState('')
  const [pending, setPending] = useState<ChatAttachmentDto[]>([])
  // What the in-flight send carried, so a refused turn can hand it back.
  const inFlight = useRef<{ text: string; attachments: ChatAttachmentDto[] } | null>(null)
  // Transcript length when the current turn was sent (commit detection only
  // looks at messages after it).
  const turnStart = useRef(initial.length)

  const { messages, setMessages, sendMessage, status, error } = useChat<DesignChatMessage>({
    id: `design-chat-${sessionId}`,
    messages: initial,
    transport,
    onError: (err) => {
      const sent = inFlight.current
      inFlight.current = null
      // PF12: a 4xx (or the pre-engine 503) is refused before anything is
      // stored — drop the optimistic user bubble and put its text +
      // attachments back in the composer.
      if (!(err instanceof ChatRequestError) || !restoresComposer(err.status, err.message) || !sent) return
      setMessages((ms) => (ms.length > 0 && ms[ms.length - 1].role === 'user' ? ms.slice(0, -1) : ms))
      setText((t) => (t.trim() ? t : sent.text))
      setPending((p) => [...sent.attachments, ...p])
    },
  })
  const busy = status === 'submitted' || status === 'streaming'
  const refused = error instanceof ChatRequestError

  const [annotate, setAnnotate] = useState<AnnotateSource | null>(null)
  const closeAnnotate = useCallback(() => setAnnotate(null), [])
  const [uploading, setUploading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [turnAnnouncement, setTurnAnnouncement] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  // Whether the admin is reading the latest messages: only then does new
  // output keep the transcript pinned to the bottom. Updated on scroll.
  const stickToBottom = useRef(true)
  const wasBusy = useRef(false)

  // Screenshot/preview URLs are signed for 1 h and the history loads once: a
  // chat left open longer re-fetches it when shown again — only while idle
  // with an empty composer, so nothing in progress is lost to the remount.
  const mountedAt = useRef(0)
  const idle = !busy && !uploading && !capturing && text.trim() === '' && pending.length === 0 && annotate === null
  const idleRef = useRef(idle)
  const onStaleRef = useRef(onStale)
  useEffect(() => {
    idleRef.current = idle
    onStaleRef.current = onStale
  }, [idle, onStale])
  // Mount-only (the parent re-renders on every Studio poll).
  useEffect(() => {
    mountedAt.current = Date.now()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && idleRef.current && Date.now() - mountedAt.current > SIGNED_VIEW_STALE_MS) onStaleRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Scroll ONLY the transcript box (scrollIntoView also scrolled the Studio
  // column behind it on every streamed chunk), and only when pinned.
  useEffect(() => {
    const el = transcriptRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // Once per finished turn: if it committed a version, refresh the Studio,
  // the Controls preview and the editor's publish count.
  useEffect(() => {
    if (busy) {
      wasBusy.current = true
      return
    }
    if (!wasBusy.current) return
    wasBusy.current = false
    inFlight.current = null
    const last = lastAssistant(messages.slice(turnStart.current))
    const committed = !!last && messageCommitted(last)
    setTurnAnnouncement(committed ? 'Reply received — a new version was saved to the draft.' : 'Reply received.')
    if (committed) onCommitted()
  }, [busy, messages, onCommitted])

  const canAttach = !busy && !capturing && !uploading && pending.length < MAX_ATTACHMENTS_PER_MESSAGE
  // One turn at a time: a second send while one streams would double-spend
  // (the draft's sha guard would 409 its commit anyway).
  const canSend = !busy && !uploading && text.trim().length > 0

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || busy || uploading) return
    const attachments = pending
    inFlight.current = { text: t, attachments }
    turnStart.current = messages.length
    setText('')
    setPending([])
    setNotice(null)
    void sendMessage({ text: t, metadata: { attachments } }, { body: { attachmentIds: attachments.map((a) => a.id) } })
  }

  // AnnotateCanvas shows a failure itself (the promise rejects into it).
  const attach = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await designApi<{ attachment: ChatAttachmentDto }>(`/api/edit/${sessionId}/design/attachments`, { method: 'POST', form })
      setPending((p) => [...p, res.attachment])
      setAnnotate(null)
    } finally {
      setUploading(false)
    }
  }

  const removePending = async (id: string) => {
    setPending((p) => p.filter((a) => a.id !== id))
    try {
      await designApi(`/api/edit/${sessionId}/design/attachments/${id}`, { method: 'DELETE' })
    } catch {
      // An orphaned private object is harmless; the chip is already gone.
    }
  }

  const screenshotDraft = async () => {
    setCapturing(true)
    setNotice(null)
    try {
      const res = await designApi<{ shots: { kind: string; url: string }[] }>(`/api/edit/${sessionId}/design/render`, {
        method: 'POST',
        // PF11: just the fold — block crops aren't needed to annotate.
        json: { path: page, viewport: 'desktop', crops: false },
      })
      const fold = res.shots.find((s) => s.kind === 'fold')
      if (!fold) throw new Error('The draft could not be captured.')
      setAnnotate({ kind: 'url', url: fold.url, label: `Current draft · ${page}` })
    } catch (err) {
      setNotice(errorMessage(err, 'The draft could not be captured.'))
    } finally {
      setCapturing(false)
    }
  }

  const clear = async () => {
    setClearing(true)
    try {
      await designApi(`/api/edit/${sessionId}/design/chat`, { method: 'DELETE' })
      onCleared()
    } catch (err) {
      setNotice(errorMessage(err, 'Failed to clear the chat'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <div
        ref={transcriptRef}
        onScroll={(e) => {
          stickToBottom.current = isNearBottom(e.currentTarget.scrollTop, e.currentTarget.clientHeight, e.currentTarget.scrollHeight)
        }}
        role="region"
        aria-label="Conversation"
        tabIndex={0}
        className={`flex h-[440px] flex-col gap-3 overflow-y-auto rounded-lg border border-border-default bg-surface-subtle p-3 ${FOCUS}`}
      >
        {messages.length === 0 && (
          <p className="font-body text-xs italic text-text-muted">
            Try: attach an annotated screenshot and say “make these cards calmer”, or ask “warm up the navy a little” or “more breathing room between sections”.
          </p>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex flex-col items-end gap-1.5">
              {(m.metadata?.attachments ?? []).some((a) => a.url) && (
                <div className="flex gap-1.5">
                  {(m.metadata?.attachments ?? []).flatMap((a) =>
                    a.url ? [
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={a.id} src={a.url} alt="Attached screenshot" className="h-16 w-auto rounded-lg border border-border-default" />,
                    ] : []
                  )}
                </div>
              )}
              <p className="max-w-[90%] whitespace-pre-wrap rounded-2xl bg-brand-navy px-3.5 py-2 font-body text-sm text-text-inverse">{messageText(m)}</p>
            </div>
          ) : (
            <div key={m.id} className="flex max-w-[95%] flex-col gap-2 rounded-2xl border border-border-default bg-surface-card px-3.5 py-2.5">
              {chatBlocks(m).map((b, i) => (
                <Block key={i} block={b} onAnnotate={(url, label) => setAnnotate({ kind: 'url', url, label })} />
              ))}
            </div>
          )
        )}
        {status === 'submitted' && <p className="font-body text-xs italic text-text-muted">Thinking…</p>}
      </div>
      {/* One announcement per turn state instead of re-reading every streamed chunk. */}
      <p role="status" className="sr-only">
        {busy ? 'The assistant is working…' : turnAnnouncement}
      </p>

      {error &&
        (refused ? (
          <p role="alert" className="font-body text-xs text-error">
            {error.message}
          </p>
        ) : (
          <AiIssueNotice message={error.message} />
        ))}

      <form onSubmit={send} className="flex flex-col gap-2">
        {pending.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Attachments for the next message">
            {pending.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5 rounded-pill border border-border-default bg-surface-card py-0.5 pl-1 pr-2">
                {a.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt="" className="h-6 w-auto rounded" />
                )}
                <span className="font-body text-[11px] text-text-secondary">Screenshot</span>
                <button type="button" onClick={() => void removePending(a.id)} aria-label="Remove attachment" className={`rounded-pill px-1 font-heading text-[11px] font-semibold text-text-secondary hover:text-error ${FOCUS}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="design-chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="design-chat-input"
          value={text}
          maxLength={CHAT_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          rows={2}
          placeholder="Describe the change…"
          className={TEXTAREA}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!canAttach} className={SECONDARY_BTN_SM}>
            Upload image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) setAnnotate({ kind: 'file', file: f, label: f.name })
            }}
          />
          <button type="button" onClick={() => void screenshotDraft()} disabled={!canAttach} className={SECONDARY_BTN_SM}>
            {capturing ? 'Capturing…' : 'Screenshot the draft'}
          </button>
          <span className="flex-1" />
          <InlineConfirm label="Clear chat" prompt="Delete this conversation?" confirmLabel="Clear" busy={busy || clearing} onConfirm={clear} />
          <button type="submit" disabled={!canSend} className={PRIMARY_BTN}>
            {busy ? 'Working…' : uploading ? 'Attaching…' : 'Send'}
          </button>
        </div>
        {notice && (
          <p role="alert" className="font-body text-xs text-error">
            {notice}
          </p>
        )}
      </form>

      {annotate && <AnnotateCanvas source={annotate} onCancel={closeAnnotate} onSave={attach} />}
    </>
  )
}

function Block({ block, onAnnotate }: { block: ChatBlock; onAnnotate: (url: string, label: string) => void }) {
  switch (block.kind) {
    case 'text':
      return <p className="whitespace-pre-wrap font-body text-sm text-text-primary">{block.text}</p>
    case 'working':
      return <p className="font-body text-xs italic text-text-muted">{block.label}</p>
    case 'edit':
      return (
        <p className={`self-start rounded-pill border px-2.5 py-0.5 font-body text-[11px] ${block.ok ? TONE.success : TONE.error}`}>
          {block.ok ? '✓' : '✕'} {block.label}
          {block.detail ? ` — ${block.detail}` : ''}
        </p>
      )
    case 'preview':
      return (
        <div className="flex flex-col gap-1.5">
          <p className="font-heading text-[11px] font-semibold text-text-secondary">
            Preview {block.previewNo} · {block.page}
          </p>
          <div className="grid grid-cols-[3fr_1fr] gap-2">
            {block.shots.map((s) => (
              <figure key={s.viewport} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={`Preview ${block.previewNo}, ${s.viewport}`} className="w-full rounded-lg border border-border-default" />
                <button type="button" onClick={() => onAnnotate(s.url, `Preview ${block.previewNo} · ${s.viewport}`)} className={`self-start ${SECONDARY_BTN_SM}`}>
                  Annotate
                </button>
              </figure>
            ))}
          </div>
          {block.gateFailures.length > 0 && (
            <ul className="list-disc pl-4 font-body text-[11px] text-error">
              {block.gateFailures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {block.warnings.map((w) => (
            <p key={w} className="font-body text-[11px] text-warning-strong">
              {w}
            </p>
          ))}
        </div>
      )
    case 'notice':
      return (
        <div role={block.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-1.5 font-body text-xs ${TONE[block.tone]}`}>
          <p className="font-heading font-semibold">{block.text}</p>
          {block.items.length > 0 && (
            <ul className="mt-0.5 list-disc pl-4">
              {block.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      )
  }
}
