'use client'
import { useState, useCallback } from 'react'
import type { Json } from '@/types/database'

type SchemaObj = Record<string, unknown>

const SECTIONS: { label: string; path: string }[] = [
  { label: 'Contact',       path: 'contact' },
  { label: 'Business',      path: 'business' },
  { label: 'Brand & Tone',  path: 'brand' },
  { label: 'Locations',     path: 'locations' },
  { label: 'Team',          path: 'team' },
  { label: 'Services',      path: 'services' },
  { label: 'Niches',        path: 'niches' },
  { label: 'Technical',     path: 'technical' },
  { label: 'Culture',       path: 'culture' },
  { label: 'Assets',        path: 'assets' },
  { label: 'Additional',    path: 'additional' },
]

function displayKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function valueToEditString(v: unknown): string {
  if (isPrimitive(v)) return String(v)
  return JSON.stringify(v, null, 2)
}

function parseEditString(raw: string, original: unknown): unknown {
  if (typeof original === 'number') {
    const n = Number(raw)
    return isNaN(n) ? raw : n
  }
  if (typeof original === 'boolean') {
    return raw.toLowerCase() === 'true'
  }
  if (typeof original === 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

type FieldRowProps = {
  fieldPath: string
  label: string
  value: unknown
  onSave: (fieldPath: string, value: unknown) => Promise<void>
}

function FieldRow({ fieldPath, label, value, onSave }: FieldRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')

  function startEdit() {
    setDraft(valueToEditString(value))
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
  }

  async function commitEdit() {
    setEditing(false)
    const parsed = parseEditString(draft, value)
    if (String(parsed) === String(value)) return
    setState('saving')
    await onSave(fieldPath, parsed)
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && isPrimitive(value)) {
      e.preventDefault()
      void commitEdit()
    }
    if (e.key === 'Escape') cancelEdit()
  }

  const displayValue = value === null || value === undefined || value === ''
    ? <span className="text-text-muted italic">—</span>
    : isPrimitive(value)
      ? <span className="text-text-primary">{String(value)}</span>
      : <span className="text-text-secondary font-mono text-xs">{JSON.stringify(value)}</span>

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border-default last:border-0 group -mx-4 px-4">
      <span className="text-text-secondary text-xs font-body w-32 flex-shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1">
            {isPrimitive(value) || value === null || value === undefined ? (
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full text-sm font-body border border-brand-cyan rounded px-2 py-1 focus:outline-none bg-surface-card"
              />
            ) : (
              <textarea
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={4}
                className="w-full text-xs font-mono border border-brand-cyan rounded px-2 py-1 focus:outline-none bg-surface-card resize-y"
              />
            )}
            <div className="flex gap-2">
              <button
                onMouseDown={e => { e.preventDefault(); void commitEdit() }}
                className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
              >
                Save
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); cancelEdit() }}
                className="text-xs font-body text-text-muted hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="text-sm font-body truncate cursor-pointer hover:bg-surface-subtle -mx-1 px-1 rounded"
            onClick={startEdit}
          >
            {state === 'saving'
              ? <span className="text-text-muted italic">Saving…</span>
              : state === 'saved'
                ? <span className="text-green-600 text-xs font-semibold">Saved ✓</span>
                : displayValue}
          </div>
        )}
      </div>
      {!editing && state === 'idle' && (
        <button
          onClick={startEdit}
          className="text-text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5 hover:text-brand-cyan"
        >
          Edit
        </button>
      )}
    </div>
  )
}

type SectionProps = {
  label: string
  path: string
  data: unknown
  sessionId: string
  onSave: (fieldPath: string, value: unknown) => Promise<void>
}

function SchemaSection({ label, path, data, onSave }: SectionProps) {
  const [open, setOpen] = useState(true)

  if (data === null || data === undefined) {
    return (
      <div className="border border-border-default rounded-lg overflow-hidden">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-surface-subtle text-left"
        >
          <span className="text-sm font-heading font-semibold text-text-primary">{label}</span>
          <span className="text-text-muted text-xs">{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <div className="px-4 py-3">
            <p className="text-text-muted font-body text-sm italic">No data collected yet.</p>
          </div>
        )}
      </div>
    )
  }

  const entries: [string, unknown][] = typeof data === 'object' && !Array.isArray(data)
    ? Object.entries(data as Record<string, unknown>)
    : [['value', data]]

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-subtle text-left hover:bg-surface-card transition-colors"
      >
        <span className="text-sm font-heading font-semibold text-text-primary">{label}</span>
        <span className="text-text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-1">
          {entries.map(([key, val]) => (
            <FieldRow
              key={key}
              fieldPath={`${path}.${key}`}
              label={displayKey(key)}
              value={val}
              onSave={onSave}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SchemaViewer({
  sessionId,
  schemaData,
}: {
  sessionId: string
  schemaData: Json
}) {
  const schema = (schemaData as SchemaObj) ?? {}

  const handleSave = useCallback(async (fieldPath: string, value: unknown) => {
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldPath, value, isAdminOverride: true }),
    })
  }, [sessionId])

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-heading font-semibold text-text-primary">Collected Data</h2>
      {SECTIONS.map(s => (
        <SchemaSection
          key={s.path}
          label={s.label}
          path={s.path}
          data={schema[s.path]}
          sessionId={sessionId}
          onSave={handleSave}
        />
      ))}
    </div>
  )
}
