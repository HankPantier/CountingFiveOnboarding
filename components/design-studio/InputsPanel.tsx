'use client'

import { useRef, useState, type FormEvent } from 'react'
import {
  INPUT_KIND_LABELS,
  INPUT_LABEL_MAX,
  URL_INPUT_KINDS,
  type DesignInputDto,
  type InputSuggestions,
  type UrlInputKind,
} from '@/lib/design/studio-types'
import { displayHost, parseUrlInputKind } from '@/lib/design/input-validation'
import InputCard from './InputCard'
import { designApi, errorMessage } from './api'
import { CHIP, FIELD, LINK_BTN, PANEL, PRIMARY_BTN, SECONDARY_BTN } from './styles'

// Pre-check the spec's 8 MB cap in the browser for a clear message; the
// route itself enforces the same cap and magic bytes for any caller.
const CLIENT_UPLOAD_MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp'

export default function InputsPanel({
  sessionId,
  inputs,
  suggestions,
  onChanged,
}: {
  sessionId: string
  inputs: DesignInputDto[]
  suggestions: InputSuggestions
  onChanged: () => Promise<void>
}) {
  const [kind, setKind] = useState<UrlInputKind>('inspiration_url')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const archivedCount = inputs.filter((i) => i.archived).length
  const visible = inputs.filter((i) => showArchived || !i.archived)
  const hasCurrentSite = inputs.some((i) => i.kind === 'current_site' && !i.archived)
  const usedLabels = new Set(inputs.map((i) => (i.label ?? '').trim().toLowerCase()))
  const competitorChips = suggestions.competitors.filter((c) => !usedLabels.has(c.name.toLowerCase()))
  const currentSite = !hasCurrentSite ? suggestions.currentSite : null

  function prefill(nextKind: UrlInputKind, nextUrl: string, nextLabel: string) {
    setKind(nextKind)
    setUrl(nextUrl)
    setLabel(nextLabel)
    setError(null)
    urlRef.current?.focus()
  }

  async function addUrl(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAdding(true)
    setError(null)
    try {
      await designApi(`/api/edit/${sessionId}/design/inputs`, {
        method: 'POST',
        json: { kind, url, label: label.trim() || undefined },
      })
      setUrl('')
      setLabel('')
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, 'Could not add that URL'))
    } finally {
      setAdding(false)
    }
  }

  async function upload(file: File) {
    setError(null)
    if (file.size > CLIENT_UPLOAD_MAX_BYTES) {
      setError('Images must be 8 MB or smaller — export a smaller PNG, JPEG or WebP.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      await designApi(`/api/edit/${sessionId}/design/inputs/upload`, { method: 'POST', form })
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, 'Could not upload that image'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section aria-labelledby="design-inputs-heading" className={PANEL}>
      <div>
        <h2 id="design-inputs-heading" className="font-heading text-sm font-semibold text-text-primary">
          Inputs
        </h2>
        <p className="font-body text-xs text-text-muted">
          Sites and images the concepts should learn from. Competitor names come from the MBP — add their website address.
        </p>
      </div>

      {(currentSite || competitorChips.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-heading text-[11px] font-semibold text-text-secondary">Suggestions</span>
          {currentSite && (
            <button type="button" onClick={() => prefill('current_site', currentSite, 'Current site')} className={CHIP}>
              Current site · {displayHost(currentSite) ?? currentSite}
            </button>
          )}
          {competitorChips.map((c) => (
            <button key={c.name} type="button" onClick={() => prefill('competitor_url', '', c.name)} className={CHIP}>
              Competitor · {c.name}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={addUrl} className="grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)]">
        <label className="sr-only" htmlFor="design-input-kind">Kind</label>
        <select
          id="design-input-kind"
          value={kind}
          onChange={(e) => {
            const next = parseUrlInputKind(e.target.value)
            if (next) setKind(next)
          }}
          className={FIELD}
        >
          {URL_INPUT_KINDS.map((k) => (
            <option key={k} value={k}>
              {INPUT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="design-input-url">Website address</label>
        <input
          id="design-input-url"
          ref={urlRef}
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={kind === 'competitor_url' && label ? `${label} website, e.g. https://example.com` : 'https://example.com'}
          className={FIELD}
        />
        <label className="sr-only" htmlFor="design-input-label">Label</label>
        <input
          id="design-input-label"
          type="text"
          value={label}
          maxLength={INPUT_LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className={FIELD}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={adding || !url.trim()} className={PRIMARY_BTN}>
            {adding ? 'Adding…' : 'Add URL'}
          </button>
          <span className="font-body text-[11px] text-text-muted">or</span>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={SECONDARY_BTN}>
            {uploading ? 'Uploading…' : 'Upload image'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="hidden"
            aria-label="Upload an inspiration image"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-error/10 px-3 py-1.5 font-body text-xs text-error">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="font-body text-xs italic text-text-muted">
          {archivedCount > 0 ? 'All inputs are archived.' : 'No inputs yet. Add the client’s current site, a competitor or two, and anything they admire.'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((input) => (
            <li key={input.id}>
              <InputCard sessionId={sessionId} input={input} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 && (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className={LINK_BTN}>
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}
    </section>
  )
}
