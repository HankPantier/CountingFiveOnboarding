'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DesignStudioState } from '@/lib/design/studio-types'
import type { DesignRunDto } from '@/lib/design/run-types'
import { RUN_POLL_MS, runIsActive } from '@/lib/design/studio-ui'
import InputsPanel from './InputsPanel'
import RunLauncher from './RunLauncher'
import RunPanel from './RunPanel'
import VersionsPanel from './VersionsPanel'
import { designApi, errorMessage } from './api'
import { SECONDARY_BTN } from './styles'

// Admin-only Design Studio (Theme Studio → Studio tab). P3: generate and
// compare concepts, preview them live, and apply one to the draft; inputs and
// versions from P2. All state comes from GET /design; while a run is active
// the Studio polls GET /design/runs and reloads everything when it settles.
export default function DesignStudio({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<DesignStudioState | null>(null)
  const [run, setRun] = useState<DesignRunDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await designApi<DesignStudioState>(`/api/edit/${sessionId}/design`)
      setState(next)
      setRun(next.run)
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

  const active = runIsActive(run)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await designApi<{ run: DesignRunDto | null }>(`/api/edit/${sessionId}/design/runs`)
        if (cancelled) return
        setRun(res.run)
        if (!runIsActive(res.run)) void load()
      } catch {
        // Transient — keep polling; the next tick retries.
      }
    }, RUN_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, sessionId, load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-subtle">
      <div className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-card px-6 py-2.5">
        <div className="min-w-0">
          <h1 className="font-heading text-sm font-semibold text-brand-navy">Design Studio</h1>
          <p className="font-body text-xs text-text-muted">Generate distinct design concepts, compare them on the real site, and apply one to the draft.</p>
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
          <div className="flex min-w-0 flex-col gap-4">
            {/* Keyed by run so a new run starts with fresh selection / applied state. */}
            {run && <RunPanel key={run.id} sessionId={sessionId} run={run} onChanged={load} />}
            <RunLauncher sessionId={sessionId} inputs={state.inputs} disabled={active} onStarted={load} />
            <InputsPanel sessionId={sessionId} inputs={state.inputs} suggestions={state.suggestions} onChanged={load} />
          </div>
          <VersionsPanel versions={state.versions} drift={state.drift} baseline={state.baseline} themeCssStale={state.themeCssStale} />
        </div>
      ) : null}
    </div>
  )
}
