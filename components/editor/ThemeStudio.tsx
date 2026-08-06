'use client'

import { useCallback, useEffect, useState } from 'react'
import ThemePreview from './ThemePreview'
import ThemeChat from './ThemeChat'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

// Admin-only Theme Studio: a live token-driven preview of the client's site
// (left) beside the AI theme assistant (right). The assistant commits palette /
// token / per-block-CSS changes to the draft branch; on each edit we refetch the
// sources so the preview updates. Changes publish through the editor's existing
// Review changes → Publish flow (theme.css, brand.json, design.json,
// design-overrides.css all show as normal diffs).
export default function ThemeStudio({ sessionId }: { sessionId: string }) {
  const [sources, setSources] = useState<ThemeSources | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/edit/${sessionId}/theme`)
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Failed to load theme (${res.status})`)
      }
      setSources((await res.json()) as ThemeSources)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load theme')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border-default bg-surface-default px-6 py-2.5">
          <h1 className="font-heading text-sm font-semibold text-brand-navy">Theme &amp; styling</h1>
          <p className="font-body text-xs text-text-muted">
            A sample of the site&rsquo;s styled blocks. Ask the assistant to change colours, roundness, spacing, or a block&rsquo;s look — then Publish.
          </p>
        </div>
        {loading ? (
          <div className="flex flex-1 items-center justify-center font-body text-sm text-text-muted">
            Loading theme…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center font-body text-sm text-error">
            {error}
          </div>
        ) : sources ? (
          <ThemePreview sources={sources} />
        ) : null}
      </div>
      <div className="w-[360px] shrink-0">
        <ThemeChat sessionId={sessionId} onEdited={() => void load()} />
      </div>
    </div>
  )
}
