'use client'

import { useEffect, useState } from 'react'
import type { DesignBaselineResponse } from '@/lib/design/studio-types'

export type BaselineState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; error: string }

// A chat commit 409s until the session has a v0 design version; the Studio's
// state load creates it, but the chat can open first (the editor's Design
// drawer, the Controls tab), so each chat host makes sure of it on mount.
export function useDesignBaseline(sessionId: string): BaselineState {
  const [baseline, setBaseline] = useState<BaselineState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    const ensure = async () => {
      try {
        const res = await fetch(`/api/edit/${sessionId}/design/baseline`, { method: 'POST' })
        const data = (await res.json().catch(() => null)) as (DesignBaselineResponse & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !data) setBaseline({ status: 'error', error: data?.error ?? `Couldn’t prepare the design history (${res.status})` })
        else if (data.baseline.status === 'error') setBaseline({ status: 'error', error: data.baseline.error })
        else setBaseline({ status: 'ready' })
      } catch {
        if (!cancelled) setBaseline({ status: 'error', error: 'Couldn’t prepare the design history — check your connection.' })
      }
    }
    void ensure()
    return () => {
      cancelled = true
    }
  }, [sessionId])
  return baseline
}
