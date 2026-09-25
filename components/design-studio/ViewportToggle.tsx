'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { composeThemeDoc, type ComposedTheme } from '@/lib/design/composed-theme'
import { PREVIEW_VIEWPORTS, viewportScale, type PreviewViewport } from '@/lib/design/studio-ui'
import { designApi, errorMessage } from './api'
import { CHIP } from './styles'

const CHIP_ON = `${CHIP} border-brand-cyan bg-brand-cyan/10 text-brand-navy`

// Live preview of ONE concept on the real page shell at 1440 / 768 / 390 px:
// the iframe is laid out at the true viewport width and scaled down to fit.
// Fully sandboxed (no scripts, no same-origin), like the Theme Studio preview.
export default function ViewportToggle({ sessionId, conceptId, conceptName, pagePath }: { sessionId: string; conceptId: string; conceptName: string; pagePath: string }) {
  const [viewport, setViewport] = useState<PreviewViewport>(PREVIEW_VIEWPORTS[0])
  const [shell, setShell] = useState<{ path: string; html: string } | null>(null)
  const [theme, setTheme] = useState<{ id: string; theme: ComposedTheme } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const frameBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await designApi<{ shellHtml: string }>(`/api/edit/${sessionId}/theme/shell?path=${encodeURIComponent(pagePath)}`)
        if (!cancelled) setShell({ path: pagePath, html: res.shellHtml })
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Couldn’t load the page'))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId, pagePath])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await designApi<{ theme: ComposedTheme }>(`/api/edit/${sessionId}/design/concepts/${conceptId}/preview`)
        if (!cancelled) setTheme({ id: conceptId, theme: res.theme })
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Couldn’t load the concept preview'))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId, conceptId])

  useEffect(() => {
    const el = frameBox.current
    if (!el) return
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const ready = shell?.path === pagePath && theme?.id === conceptId
  const srcDoc = useMemo(() => (ready && shell && theme ? composeThemeDoc(shell.html, theme.theme) : null), [ready, shell, theme])
  const scale = viewportScale(width, viewport.width)

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Preview viewport" className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-xs font-semibold text-text-primary">Live preview · {conceptName}</span>
        {PREVIEW_VIEWPORTS.map((v) => (
          <button
            key={v.width}
            type="button"
            aria-pressed={viewport.width === v.width}
            onClick={() => setViewport(v)}
            className={viewport.width === v.width ? CHIP_ON : CHIP}
          >
            {v.label} {v.width}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="font-body text-xs text-error">
          {error}
        </p>
      )}
      <div
        ref={frameBox}
        className="relative w-full overflow-hidden rounded-lg border border-border-default bg-surface-subtle"
        // Computed geometry only (the scaled viewport height).
        style={{ height: Math.round(viewport.height * scale) }}
      >
        {srcDoc ? (
          <iframe
            title={`${conceptName} at ${viewport.width}px`}
            srcDoc={srcDoc}
            sandbox=""
            className="absolute left-0 top-0 border-0 bg-surface-card"
            // Computed geometry only: true viewport size, scaled to fit.
            style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
        ) : (
          !error && <p className="p-3 font-body text-xs text-text-muted">Loading the preview…</p>
        )}
      </div>
    </div>
  )
}
