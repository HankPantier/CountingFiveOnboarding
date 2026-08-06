'use client'

import { useCallback, useEffect, useState } from 'react'
import ThemePreview from './ThemePreview'
import ThemeChat from './ThemeChat'
import type { ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

// Admin-only Theme Studio: a live 1:1 preview of the client's REAL deployed site
// (left) beside the AI theme assistant (right). The site "shell" (real markup +
// real compiled CSS) is fetched once; the assistant commits palette / token /
// per-block-CSS changes to the draft branch and we refetch the theme sources so
// the preview re-skins instantly. Changes publish through the editor's existing
// Review changes → Publish flow.
export default function ThemeStudio({ sessionId }: { sessionId: string }) {
  const [sources, setSources] = useState<ThemeSources | null>(null)
  const [shellHtml, setShellHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Re-skin data — cheap, refetched after every AI edit.
  const loadSources = useCallback(async () => {
    const res = await fetch(`/api/edit/${sessionId}/theme`)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load theme (${res.status})`)
    }
    setSources((await res.json()) as ThemeSources)
  }, [sessionId])

  // Real-site shell — fetched once (expensive external fetch).
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const shellRes = await fetch(`/api/edit/${sessionId}/theme/shell`)
      if (!shellRes.ok) {
        const data = (await shellRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Failed to load the live site (${shellRes.status})`)
      }
      const shell = (await shellRes.json()) as { shellHtml: string }
      setShellHtml(shell.shellHtml)
      await loadSources()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }, [sessionId, loadSources])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll()
  }, [loadAll])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border-default bg-surface-default px-6 py-2.5">
          <h1 className="font-heading text-sm font-semibold text-brand-navy">Theme &amp; styling</h1>
          <p className="font-body text-xs text-text-muted">
            A live preview of the site. Ask the assistant to change colours, roundness, spacing, or a block&rsquo;s look — then Publish.
          </p>
        </div>
        {loading ? (
          <div className="flex flex-1 items-center justify-center font-body text-sm text-text-muted">
            Loading the live site…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center font-body text-sm text-error">
            {error}
          </div>
        ) : shellHtml && sources ? (
          <ThemePreview shellHtml={shellHtml} sources={sources} />
        ) : null}
      </div>
      <div className="w-[360px] shrink-0">
        <ThemeChat sessionId={sessionId} onEdited={() => void loadSources().catch(() => {})} />
      </div>
    </div>
  )
}
