'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DesignStudioState } from '@/lib/design/studio-types'
import InputsPanel from './InputsPanel'
import VersionsPanel from './VersionsPanel'
import { designApi, errorMessage } from './api'
import { SECONDARY_BTN } from './styles'

// Admin-only Design Studio (Theme Studio → Studio tab). P2: collect design
// inputs and track theme versions (v0 baseline, drift, stale theme.css).
// Concept generation arrives in P3. All state comes from GET /design.
export default function DesignStudio({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<DesignStudioState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await designApi<DesignStudioState>(`/api/edit/${sessionId}/design`))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the Design Studio'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-subtle">
      <div className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-card px-6 py-2.5">
        <div className="min-w-0">
          <h1 className="font-heading text-sm font-semibold text-brand-navy">Design Studio</h1>
          <p className="font-body text-xs text-text-muted">
            Collect inspiration, competitors and the client’s current site, and track every theme version. Concept generation is coming next.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          disabled={loading}
          className={`shrink-0 ${SECONDARY_BTN}`}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" className="border-b border-error/20 bg-error/10 px-6 py-2 font-body text-xs text-error">
          {error}
        </div>
      )}

      {!state && loading ? (
        <div className="flex flex-1 items-center justify-center font-body text-sm text-text-muted">Loading the Design Studio…</div>
      ) : state ? (
        <div className="grid flex-1 items-start gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <InputsPanel sessionId={sessionId} inputs={state.inputs} suggestions={state.suggestions} onChanged={load} />
          <VersionsPanel versions={state.versions} drift={state.drift} baseline={state.baseline} themeCssStale={state.themeCssStale} />
        </div>
      ) : null}
    </div>
  )
}
