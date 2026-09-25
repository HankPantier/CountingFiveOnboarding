'use client'

import { useState } from 'react'
import type { DesignRunDto } from '@/lib/design/run-types'
import { applicableConcepts, formatUsd, runIsActive, runStatusLabel } from '@/lib/design/studio-ui'
import BeforeAfter from './BeforeAfter'
import CompareGrid from './CompareGrid'
import ConceptCards from './ConceptCards'
import InlineConfirm from './InlineConfirm'
import ViewportToggle from './ViewportToggle'
import { designApi, errorMessage } from './api'
import { PANEL, SECONDARY_BTN_SM } from './styles'

// The latest run: status + cost, notes (skipped inputs, capability strips),
// cancel / retry, concept cards, the synced compare grid and a live preview.
export default function RunPanel({ sessionId, run, onChanged }: { sessionId: string; run: DesignRunDto; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [appliedNo, setAppliedNo] = useState<number | null>(null)
  const [appliedWarnings, setAppliedWarnings] = useState<string[]>([])

  const active = runIsActive(run)
  const usable = applicableConcepts(run)
  const selected = usable.find((c) => c.id === selectedId) ?? usable[0] ?? null

  const act = async (path: string, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      await designApi(`/api/edit/${sessionId}/design/runs/${run.id}/${path}`, { method: 'POST' })
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="run-panel-heading" className={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="run-panel-heading" className="font-heading text-sm font-semibold text-text-primary">
            {runStatusLabel(run)}
          </h2>
          <p className="font-body text-xs text-text-muted">
            Page {run.pagePath} · palette {run.paletteFreedom} · {formatUsd(run.costUsd)} of {formatUsd(run.costCapUsd)} cap
            {run.capabilities.level < 2 ? ' · fonts locked on this site' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {active && (
            <InlineConfirm label="Cancel run" prompt="Stop this run?" confirmLabel="Stop" busy={busy} onConfirm={() => act('cancel', 'Couldn’t cancel the run')} />
          )}
          {run.status === 'error' && (
            <button type="button" onClick={() => void act('step', 'Couldn’t retry the run')} disabled={busy} className={SECONDARY_BTN_SM}>
              Retry
            </button>
          )}
        </div>
      </div>

      {run.error && (
        <p role="alert" className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body text-xs text-error">
          {run.error}
        </p>
      )}
      {error && (
        <p role="alert" className="font-body text-xs text-error">
          {error}
        </p>
      )}
      {appliedNo !== null && (
        <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 font-body text-xs text-success">
          Applied to the draft as v{appliedNo}. Review it, then Publish from the editor when ready (Publish ships all draft changes).
        </p>
      )}
      {appliedNo !== null && appliedWarnings.length > 0 && (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 font-body text-xs text-warning-strong">
          {appliedWarnings.join(' ')}
        </p>
      )}
      {run.notes.length > 0 && (
        <details className="font-body text-xs text-text-secondary">
          <summary className="cursor-pointer font-heading font-semibold text-text-primary">Notes ({run.notes.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {run.notes.map((n, i) => (
              <li key={`${i}-${n}`}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      {run.concepts.length > 0 && (
        <ConceptCards
          sessionId={sessionId}
          concepts={run.concepts}
          selectedId={selected?.id ?? null}
          maxRevisions={run.maxRevisions}
          onSelect={setSelectedId}
          onApplied={async (versionNo, warnings) => {
            setAppliedNo(versionNo)
            setAppliedWarnings(warnings)
            await onChanged()
          }}
        />
      )}
      <CompareGrid run={run} />
      {selected && <BeforeAfter concept={selected} />}
      {selected && <ViewportToggle sessionId={sessionId} conceptId={selected.id} conceptName={selected.name} pagePath={run.pagePath} />}
    </section>
  )
}
