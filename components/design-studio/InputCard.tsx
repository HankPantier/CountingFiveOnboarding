'use client'

import { useState } from 'react'
import { INPUT_KIND_LABELS, INPUT_LABEL_MAX, INPUT_NOTES_MAX, type DesignInputDto } from '@/lib/design/studio-types'
import { displayHost } from '@/lib/design/input-validation'
import InlineConfirm from './InlineConfirm'
import { designApi, errorMessage } from './api'
import { FIELD, PRIMARY_BTN_SM, SECONDARY_BTN_SM, TEXTAREA } from './styles'

type Busy = 'capture' | 'save' | 'archive' | 'delete' | null

// One design input: thumbnail (signed URL), capture / re-capture for URL kinds,
// edit label + notes, archive, and a two-step delete.
export default function InputCard({
  sessionId,
  input,
  onChanged,
}: {
  sessionId: string
  input: DesignInputDto
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const base = `/api/edit/${sessionId}/design/inputs/${input.id}`
  const capturing = busy === 'capture' || input.captureStatus === 'pending'
  const title = input.label || displayHost(input.url) || 'Uploaded image'
  const canCapture = input.kind !== 'inspiration_image'

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<unknown>, fallback: string) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, fallback))
    } finally {
      setBusy(null)
    }
  }

  const startEdit = () => {
    setLabelDraft(input.label ?? '')
    setNotesDraft(input.notes ?? '')
    setEditing(true)
  }

  return (
    <article className="flex h-full flex-col gap-2 rounded-xl border border-border-default bg-surface-card p-3 shadow-subtle">
      <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border-default bg-surface-subtle">
        {input.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
          <img src={input.thumbnailUrl} alt={`Screenshot of ${title}`} className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center font-body text-[11px] text-text-muted">
            {capturing ? 'Capturing…' : input.captureStatus === 'error' ? 'Capture failed' : 'Not captured yet'}
          </div>
        )}
        {capturing && input.thumbnailUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-card/70 font-heading text-xs font-semibold text-brand-navy">
            Capturing…
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-pill bg-surface-subtle px-2 py-0.5 font-heading text-[10px] font-semibold text-text-secondary">
            {INPUT_KIND_LABELS[input.kind]}
          </span>
          {input.archived && (
            <span className="shrink-0 rounded-pill bg-warning/10 px-2 py-0.5 font-heading text-[10px] font-semibold text-warning-strong">Archived</span>
          )}
        </div>
        <h3 className="mt-1 truncate font-heading text-xs font-semibold text-text-primary" title={title}>
          {title}
        </h3>
        {input.url && (
          <a
            href={input.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-body text-[11px] text-text-muted hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
          >
            {input.url}
          </a>
        )}
        {input.captureStatus === 'error' && input.captureError && (
          <p className="mt-1 font-body text-[11px] text-error">{input.captureError}</p>
        )}
        {!editing && input.notes && <p className="mt-1 whitespace-pre-wrap font-body text-[11px] text-text-secondary">{input.notes}</p>}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(
              'save',
              async () => {
                await designApi(base, { method: 'PATCH', json: { label: labelDraft, notes: notesDraft } })
                setEditing(false)
              },
              'Could not save'
            )
          }}
          className="flex flex-col gap-1.5"
        >
          <label className="sr-only" htmlFor={`label-${input.id}`}>Label</label>
          <input id={`label-${input.id}`} value={labelDraft} maxLength={INPUT_LABEL_MAX} onChange={(e) => setLabelDraft(e.target.value)} placeholder="Label" className={FIELD} />
          <label className="sr-only" htmlFor={`notes-${input.id}`}>Notes</label>
          <textarea
            id={`notes-${input.id}`}
            value={notesDraft}
            maxLength={INPUT_NOTES_MAX}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="What to take from this (e.g. the calm type, not the colours)"
            className={TEXTAREA}
          />
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy !== null} className={PRIMARY_BTN_SM}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={SECONDARY_BTN_SM}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {canCapture && (
            <button
              type="button"
              onClick={() => void run('capture', () => designApi(`${base}/capture`, { method: 'POST' }), 'Capture failed')}
              disabled={busy !== null || capturing}
              className={PRIMARY_BTN_SM}
            >
              {capturing ? 'Capturing… (up to a minute)' : input.thumbnailUrl ? 'Re-capture' : 'Capture'}
            </button>
          )}
          <button type="button" onClick={startEdit} disabled={busy !== null} className={SECONDARY_BTN_SM}>
            Edit
          </button>
          <button
            type="button"
            onClick={() => void run('archive', () => designApi(base, { method: 'PATCH', json: { archived: !input.archived } }), 'Could not update')}
            disabled={busy !== null}
            className={SECONDARY_BTN_SM}
          >
            {input.archived ? 'Unarchive' : 'Archive'}
          </button>
          <InlineConfirm
            label="Delete"
            prompt="Delete this input?"
            confirmLabel="Delete"
            busy={busy !== null}
            onConfirm={() => run('delete', () => designApi(base, { method: 'DELETE' }), 'Could not delete')}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-error/10 px-2.5 py-1 font-body text-[11px] text-error">
          {error}
        </p>
      )}
    </article>
  )
}
