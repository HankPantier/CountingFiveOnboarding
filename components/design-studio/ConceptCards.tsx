'use client'

import { useEffect, useRef, useState } from 'react'
import type { DesignConceptDto } from '@/lib/design/run-types'
import { conceptStatusLabel } from '@/lib/design/critique-ui'
import ApplyDialog from './ApplyDialog'
import CritiqueView from './CritiqueView'
import { PRIMARY_BTN_SM, SECONDARY_BTN_SM } from './styles'

// One card per concept: name, palette swatches, type, key levers, moves and
// render / critique-loop status, the critique itself, with Preview (drives the live iframe) and Apply.
export default function ConceptCards({
  sessionId,
  concepts,
  selectedId,
  maxRevisions,
  onSelect,
  onApplied,
}: {
  sessionId: string
  concepts: DesignConceptDto[]
  selectedId: string | null
  maxRevisions: number
  onSelect: (id: string) => void
  onApplied: (versionNo: number, warnings: string[]) => void | Promise<void>
}) {
  // One apply dialog at a time: while it is open every Apply… is disabled, so
  // an in-flight apply can never be unmounted by opening another concept's
  // dialog (its result or gate failure would be lost).
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const applyButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  const returnFocusTo = useRef<string | null>(null)
  useEffect(() => {
    if (applyingId !== null || !returnFocusTo.current) return
    applyButtons.current[returnFocusTo.current]?.focus()
    returnFocusTo.current = null
  }, [applyingId])

  return (
    <ul className="grid gap-3 lg:grid-cols-3">
      {concepts.map((c) => {
        const usable = c.status === 'ready' && c.palette !== null
        const selected = c.id === selectedId
        return (
          <li
            key={c.id}
            className={`flex min-w-0 flex-col gap-2 rounded-lg border bg-surface-card p-3 ${selected ? 'border-brand-cyan shadow-subtle' : 'border-border-default'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-heading text-sm font-semibold text-text-primary">{c.name}</h3>
                {c.tagline && <p className="font-body text-xs text-text-muted">{c.tagline}</p>}
              </div>
              <span className="shrink-0 rounded-pill bg-surface-subtle px-2 py-0.5 font-heading text-[10px] font-semibold text-text-secondary">
                {conceptStatusLabel(c, maxRevisions)}
              </span>
            </div>

            {c.palette && (
              <div role="img" className="flex gap-1" aria-label={`Palette: ${Object.entries(c.palette).map(([role, hex]) => `${role} ${hex}`).join(', ')}`}>
                {Object.entries(c.palette).map(([role, hex]) => (
                  // Data-driven swatch colour (same exception as ThemeControls).
                  <span key={role} title={`${role} ${hex}`} className="h-5 w-5 rounded-full border border-border-default" style={{ backgroundColor: hex }} />
                ))}
              </div>
            )}

            {c.typography && (
              <p className="font-body text-[11px] text-text-secondary">
                {c.typography.headingFont} / {c.typography.bodyFont} · accent {c.typography.accentFont}
              </p>
            )}
            {c.tokens && c.treatments && (
              <p className="font-body text-[11px] text-text-muted">
                {c.tokens.roundness} · {c.tokens.density} · {c.tokens.visualFeel} · {c.treatments.headlineStyle} headlines
                {c.treatments.darkSections ? ' · ink bands' : ''}
              </p>
            )}
            {c.moves.length > 0 && (
              <ul className="list-disc pl-4 font-body text-[11px] text-text-secondary">
                {c.moves.map((move) => (
                  <li key={move}>{move}</li>
                ))}
              </ul>
            )}
            {c.review && <CritiqueView review={c.review} iterations={c.iterations} maxRevisions={maxRevisions} />}
            {c.error && <p className="font-body text-[11px] text-warning-strong">{c.error}</p>}

            {usable && (
              <div className="mt-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Preview ${c.name}`}
                  onClick={() => onSelect(c.id)}
                  className={SECONDARY_BTN_SM}
                >
                  {selected ? 'Previewing' : 'Preview'}
                </button>
                <button
                  ref={(el) => {
                    applyButtons.current[c.id] = el
                  }}
                  type="button"
                  aria-label={`Apply ${c.name}…`}
                  onClick={() => setApplyingId(c.id)}
                  disabled={applyingId !== null}
                  className={PRIMARY_BTN_SM}
                >
                  Apply…
                </button>
              </div>
            )}
            {applyingId === c.id && (
              <ApplyDialog
                sessionId={sessionId}
                concept={c}
                onCancel={() => {
                  returnFocusTo.current = c.id
                  setApplyingId(null)
                }}
                onApplied={async (versionNo, warnings) => {
                  setApplyingId(null)
                  await onApplied(versionNo, warnings)
                }}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
