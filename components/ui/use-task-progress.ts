'use client'

import { useEffect, useState } from 'react'

export type TaskProgress = {
  state: 'running' | 'done' | 'error'
  phase: string | null
  current: number
  total: number
  message: string | null
  kind: string
}

// Poll GET /api/progress/[taskId] while `active`. The task row is written by the
// worker (which shares the client-generated taskId), so this can start polling
// the instant the work request is fired. Returns null until the first row for
// the CURRENT taskId lands — stored progress is keyed by taskId so a stale value
// from a previous run is never returned (a 404 during the start window is
// expected and ignored).
export function useTaskProgress(taskId: string | null, active: boolean): TaskProgress | null {
  const [entry, setEntry] = useState<{ id: string; data: TaskProgress } | null>(null)

  useEffect(() => {
    if (!taskId || !active) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/progress/${taskId}`)
        if (cancelled || !res.ok) return
        setEntry({ id: taskId, data: (await res.json()) as TaskProgress })
      } catch {
        // transient — keep polling
      }
    }
    void poll()
    // 2.5s keeps the bar responsive without hammering /api/progress through a
    // multi-minute deploy/repull (1.5s was ~40 req/min for the whole run).
    const iv = setInterval(poll, 2500)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [taskId, active])

  return taskId && active && entry?.id === taskId ? entry.data : null
}
