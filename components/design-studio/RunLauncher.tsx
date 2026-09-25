'use client'

import { useState } from 'react'
import { INPUT_KIND_LABELS, type DesignInputDto } from '@/lib/design/studio-types'
import {
  ADMIN_BRIEF_MAX,
  DEFAULT_CONCEPT_COUNT,
  DEFAULT_PALETTE_FREEDOM,
  DEFAULT_RUN_PAGE,
  MAX_RUN_INPUTS,
  type PaletteFreedom,
} from '@/lib/design/run-types'
import { defaultRunInputIds, reconcileRunInputIds } from '@/lib/design/studio-ui'
import PagePicker from './PagePicker'
import { designApi, errorMessage } from './api'
import { CHIP, PANEL, PRIMARY_BTN, TEXTAREA } from './styles'

const FREEDOMS: { key: PaletteFreedom; label: string; help: string }[] = [
  { key: 'keep', label: 'Keep palette', help: 'Exact current colours; concepts differ by type, shape and treatments.' },
  { key: 'evolve', label: 'Evolve', help: 'Start from the current palette and push it.' },
  { key: 'free', label: 'Free', help: 'New palettes from the brand and references.' },
]

const CHIP_ON = `${CHIP} border-brand-cyan bg-brand-cyan/10 text-brand-navy`

// Start a design run: palette freedom, an optional brief, the captured inputs
// to show the model, 2–3 concepts, and the page to design against.
export default function RunLauncher({
  sessionId,
  inputs,
  disabled,
  onStarted,
}: {
  sessionId: string
  inputs: DesignInputDto[]
  disabled: boolean
  onStarted: () => void | Promise<void>
}) {
  const [freedom, setFreedom] = useState<PaletteFreedom>(DEFAULT_PALETTE_FREEDOM)
  const [brief, setBrief] = useState('')
  const [picked, setPicked] = useState<string[]>(() => defaultRunInputIds(inputs))
  const [count, setCount] = useState(DEFAULT_CONCEPT_COUNT)
  const [pagePath, setPagePath] = useState(DEFAULT_RUN_PAGE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Always intersected with the CURRENT eligible inputs, so an input archived,
  // deleted or re-captured since it was picked never reaches the POST.
  const selected = reconcileRunInputIds(picked, inputs)
  const candidates = inputs.filter((i) => !i.archived)
  const toggle = (id: string) =>
    setPicked((cur) => {
      const live = reconcileRunInputIds(cur, inputs)
      if (live.includes(id)) return live.filter((x) => x !== id)
      return live.length >= MAX_RUN_INPUTS ? live : [...live, id]
    })

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await designApi(`/api/edit/${sessionId}/design/runs`, {
        method: 'POST',
        json: { paletteFreedom: freedom, adminBrief: brief.trim() || null, inputIds: reconcileRunInputIds(picked, inputs), conceptCount: count, pagePath },
      })
      await onStarted()
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t start the run'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="run-launcher-heading" className={PANEL}>
      <div>
        <h2 id="run-launcher-heading" className="font-heading text-sm font-semibold text-text-primary">
          Generate concepts
        </h2>
        <p className="font-body text-xs text-text-muted">
          The AI designs {count} distinct concepts from the MBP, this page’s real markup, the current design and your references, then renders each one.
          A run usually costs $1–2 (hard cap $4). Fonts and style axes stay locked unless the site’s template supports them.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-heading text-xs font-semibold text-text-primary">Palette freedom</legend>
        <div className="flex flex-wrap gap-2">
          {FREEDOMS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={freedom === f.key}
              onClick={() => setFreedom(f.key)}
              disabled={disabled || busy}
              className={freedom === f.key ? CHIP_ON : CHIP}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="font-body text-[11px] text-text-muted">{FREEDOMS.find((f) => f.key === freedom)?.help}</p>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-heading text-xs font-semibold text-text-primary">Brief (optional)</span>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={ADMIN_BRIEF_MAX}
          rows={3}
          disabled={disabled || busy}
          placeholder="e.g. Warmer and more editorial; the partners want to feel like a boutique, not a big-four firm."
          className={TEXTAREA}
        />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-heading text-xs font-semibold text-text-primary">
          References ({selected.length} of {MAX_RUN_INPUTS})
        </legend>
        {candidates.length === 0 ? (
          <p className="font-body text-xs italic text-text-muted">No inputs yet — add some below (optional).</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {candidates.map((i) => {
              const captured = i.captureStatus === 'ok'
              return (
                <li key={i.id}>
                  <label className={`flex items-center gap-2 font-body text-xs ${captured ? 'text-text-secondary' : 'text-text-muted'}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(i.id)}
                      onChange={() => toggle(i.id)}
                      disabled={disabled || busy || !captured}
                      className="accent-brand-cyan"
                    />
                    <span className="min-w-0 truncate">
                      {INPUT_KIND_LABELS[i.kind]} · {i.label ?? i.url ?? 'Uploaded image'}
                      {!captured && ' — not captured yet'}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <PagePicker sessionId={sessionId} value={pagePath} onChange={setPagePath} disabled={disabled || busy} />
        <fieldset className="flex flex-col gap-1">
          <legend className="font-heading text-xs font-semibold text-text-primary">Concepts</legend>
          <div className="flex gap-2">
            {[2, 3].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                aria-label={`${n} concepts`}
                onClick={() => setCount(n)}
                disabled={disabled || busy}
                className={count === n ? CHIP_ON : CHIP}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {error && (
        <p role="alert" className="font-body text-xs text-error">
          {error}
        </p>
      )}
      <button type="button" onClick={() => void start()} disabled={disabled || busy} className={`self-start ${PRIMARY_BTN}`}>
        {busy ? 'Starting…' : disabled ? 'A run is in progress' : `Generate ${count} concepts`}
      </button>
    </section>
  )
}
