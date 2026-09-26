'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignStudioState } from '@/lib/design/studio-types'
import type { DesignRunDto } from '@/lib/design/run-types'
import { RUN_POLL_MS, SIGNED_VIEW_STALE_MS, runIsActive, startSequentialPoll, stabilizeSignedUrls, type SignedUrlCache } from '@/lib/design/studio-ui'
import DesignChat from './DesignChat'
import InputsPanel from './InputsPanel'
import RunLauncher from './RunLauncher'
import RunPanel from './RunPanel'
import VersionsPanel from './VersionsPanel'
import { designApi, errorMessage } from './api'
import { SECONDARY_BTN } from './styles'

// Admin-only Design Studio (Theme Studio → Studio tab). P3: generate and
// compare concepts, preview them live, and apply one to the draft; inputs and
// versions from P2; P5: the revision chat, restore and capture. All state comes from GET /design; while a run is active
// the Studio polls GET /design/runs and reloads everything when it settles.
export default function DesignStudio({ sessionId, onThemeChanged }: { sessionId: string; onThemeChanged?: () => void }) {
  const [state, setState] = useState<DesignStudioState | null>(null)
  const [run, setRun] = useState<DesignRunDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Request ordering: loads are triggered from many places with very different
  // latencies, so only the LATEST load may set state, and a run snapshot from
  // an older request (load or poll) never replaces a newer one.
  const loadSeq = useRef(0)
  const runSeq = useRef(0)
  const lastLoadAt = useRef(0)
  // Keeps each screenshot's signed URL stable across polls (no re-download).
  const urlCache = useRef<SignedUrlCache>(new Map())

  const load = useCallback(async () => {
    const loadId = ++loadSeq.current
    const runId = ++runSeq.current
    try {
      const raw = await designApi<DesignStudioState>(`/api/edit/${sessionId}/design`)
      if (loadId !== loadSeq.current) return
      const next = stabilizeSignedUrls(raw, urlCache.current, Date.now())
      lastLoadAt.current = Date.now()
      setState(next)
      if (runId === runSeq.current) setRun(next.run)
      setError(null)
    } catch (err) {
      if (loadId === loadSeq.current) setError(errorMessage(err, 'Failed to load the Design Studio'))
    } finally {
      if (loadId === loadSeq.current) setLoading(false)
    }
  }, [sessionId])

  // A Studio left open past the signed-URL lifetime reloads when shown again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && lastLoadAt.current > 0 && Date.now() - lastLoadAt.current > SIGNED_VIEW_STALE_MS) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useEffect(() => {
    void load()
  }, [load])

  // A concept apply, chat commit, restore or capture changed the draft theme:
  // reload the Studio and let Theme Studio refresh Controls + the publish count.
  const themeChanged = useCallback(() => {
    void load()
    onThemeChanged?.()
  }, [load, onThemeChanged])

  const active = runIsActive(run)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    // Each request settles before the next is scheduled; a failed request is
    // transient (the poller keeps going), a settled run stops it.
    const stop = startSequentialPoll(async () => {
      const runId = ++runSeq.current
      const res = await designApi<{ run: DesignRunDto | null }>(`/api/edit/${sessionId}/design/runs`)
      if (cancelled) return false
      // A load started meanwhile owns the run state; keep polling until it lands.
      if (runId !== runSeq.current) return true
      const run = stabilizeSignedUrls(res.run, urlCache.current, Date.now())
      setRun(run)
      if (runIsActive(run)) return true
      void load()
      return false
    }, RUN_POLL_MS)
    return () => {
      cancelled = true
      stop()
    }
  }, [active, sessionId, load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-subtle">
      <div className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-card px-6 py-2.5">
        <div className="min-w-0">
          <h1 className="font-heading text-sm font-semibold text-brand-navy">Design Studio</h1>
          <p className="font-body text-xs text-text-muted">Generate concepts, compare them on the real site, apply one, then refine it in the chat.</p>
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
        <div className="grid flex-1 items-start gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-4">
            {/* Keyed by run so a new run starts with fresh selection / applied state.
                PF10: only an apply changes the theme — cancel / retry just reload. */}
            {run && <RunPanel key={run.id} sessionId={sessionId} run={run} onChanged={load} onApplied={onThemeChanged} />}
            <RunLauncher sessionId={sessionId} inputs={state.inputs} disabled={active} onStarted={load} />
            <InputsPanel sessionId={sessionId} inputs={state.inputs} suggestions={state.suggestions} onChanged={load} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <DesignChat sessionId={sessionId} page="/" onCommitted={themeChanged} />
            <VersionsPanel
              sessionId={sessionId}
              versions={state.versions}
              drift={state.drift}
              baseline={state.baseline}
              themeCssStale={state.themeCssStale}
              onChanged={themeChanged}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
