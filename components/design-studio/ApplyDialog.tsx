'use client'

import { useState } from 'react'
import type { DesignConceptDto } from '@/lib/design/run-types'
import { apiFailureInfo, applyErrorMessage, applyGateFailures } from '@/lib/design/studio-ui'
import { DesignApiError, designApi, errorMessage } from './api'
import { PRIMARY_BTN_SM, SECONDARY_BTN_SM } from './styles'

type ApplyResult = { ok: true; versionId: string; versionNo: number; commitSha: string | null; changedPaths: string[]; warnings: string[] }

const APPLY_FALLBACK = 'Couldn’t apply the concept'

// Inline apply confirmation for one concept (no browser dialog). "Remove legacy
// overrides" is ON by default (spec): the Studio's managed region replaces
// every hand-written rule in design-overrides.css.
export default function ApplyDialog({
  sessionId,
  concept,
  onApplied,
  onCancel,
}: {
  sessionId: string
  concept: DesignConceptDto
  onApplied: (versionNo: number, warnings: string[]) => void | Promise<void>
  onCancel: () => void
}) {
  const [removeLegacy, setRemoveLegacy] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failures, setFailures] = useState<string[]>([])

  const apply = async () => {
    setBusy(true)
    setError(null)
    setFailures([])
    try {
      const res = await designApi<ApplyResult>(`/api/edit/${sessionId}/design/concepts/${concept.id}/apply`, {
        method: 'POST',
        json: { removeLegacyOverrides: removeLegacy },
      })
      await onApplied(res.versionNo, res.warnings ?? [])
    } catch (err) {
      const generic = errorMessage(err, APPLY_FALLBACK)
      setError(err instanceof DesignApiError ? applyErrorMessage(apiFailureInfo(err.status, err.body), generic) : generic)
      setFailures(err instanceof DesignApiError ? applyGateFailures(err.body) : [])
      setBusy(false)
    }
  }

  const headingId = `apply-${concept.id}-heading`
  return (
    <div role="dialog" aria-labelledby={headingId} className="mt-2 flex flex-col gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan/5 p-3">
      <p id={headingId} className="font-heading text-xs font-semibold text-brand-navy">
        Apply “{concept.name}” to the draft site?
      </p>
      <p className="font-body text-[11px] text-text-secondary">
        This commits the palette, tokens, treatments and CSS to the draft and records a new version. Nothing goes live until someone presses Publish in
        the editor — and Publish ships all pending draft changes, not just this design.
      </p>
      <label className="flex items-start gap-2 font-body text-xs text-text-secondary">
        <input type="checkbox" checked={removeLegacy} onChange={(e) => setRemoveLegacy(e.target.checked)} disabled={busy} className="mt-0.5 accent-brand-cyan" />
        <span>
          <span className="font-semibold text-text-primary">Remove legacy overrides</span> — replace any hand-written rules in design-overrides.css with
          this concept’s CSS (recommended).
        </span>
      </label>
      {error && (
        <p role="alert" className="font-body text-xs text-error">
          {error}
        </p>
      )}
      {failures.length > 0 && (
        <ul className="list-disc pl-4 font-body text-[11px] text-error" aria-label="Render checks that failed">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => void apply()} disabled={busy} className={PRIMARY_BTN_SM}>
          {busy ? 'Applying…' : 'Apply to draft'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY_BTN_SM}>
          Cancel
        </button>
      </div>
    </div>
  )
}
