'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatFieldValue } from '@/lib/mbp/build-document'

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function toEditString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (isPrimitive(v)) return String(v)
  return JSON.stringify(v, null, 2)
}

// Parse the edited string back to a value, matching the original type where
// possible (mirrors SchemaViewer): numbers/booleans coerce, objects/arrays
// parse as JSON, everything else stays a string.
function parseEditString(raw: string, original: unknown): unknown {
  if (typeof original === 'number') {
    const n = Number(raw)
    return isNaN(n) ? raw : n
  }
  if (typeof original === 'boolean') return raw.toLowerCase() === 'true'
  if (original !== null && typeof original === 'object') {
    try { return JSON.parse(raw) } catch { return raw }
  }
  return raw
}

export default function MbpEditableField({
  sessionId,
  fieldPath,
  value,
}: {
  sessionId: string
  fieldPath: string
  value: unknown
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const router = useRouter()

  const structured = value !== null && typeof value === 'object'
  const display = formatFieldValue(value)

  function start() {
    setDraft(toEditString(value))
    setEditing(true)
  }

  async function commit() {
    setEditing(false)
    const parsed = parseEditString(draft, value)
    if (JSON.stringify(parsed) === JSON.stringify(value)) return
    setState('saving')
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldPath, value: parsed, isAdminOverride: true }),
    })
    setState('saved')
    router.refresh()
    setTimeout(() => setState('idle'), 1500)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !structured) {
      e.preventDefault()
      void commit()
    }
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        {structured ? (
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={4}
            className="w-full text-xs font-mono border border-brand-cyan rounded px-2 py-1 focus:outline-none bg-surface-card resize-y"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full text-sm font-body border border-brand-cyan rounded px-2 py-1 focus:outline-none bg-surface-card"
          />
        )}
        <div className="flex gap-2">
          <button
            onMouseDown={e => { e.preventDefault(); void commit() }}
            className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
          >
            Save
          </button>
          <button
            onMouseDown={e => { e.preventDefault(); setEditing(false) }}
            className="text-xs font-body text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={start}
      className="text-sm font-body cursor-pointer hover:bg-surface-subtle -mx-1 px-1 rounded break-words"
      title="Click to edit"
    >
      {state === 'saving'
        ? <span className="text-text-muted italic">Saving…</span>
        : state === 'saved'
          ? <span className="text-success text-xs font-semibold">Saved ✓</span>
          : display
            ? <span className="text-text-primary">{display}</span>
            : <span className="text-text-muted italic">— add</span>}
    </div>
  )
}
