'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'
import { fetchShellWithRetry, type ShellFetchResult } from '@/lib/theme-preview/shell-fetch'
import { PREVIEW_VIEWPORTS, viewportScale, type PreviewViewport } from '@/lib/design/studio-ui'
import { themeSourcesHtmlAttributes, type ThemeSources } from '@/app/api/edit/[id]/theme/_theme'

const CHIP = 'rounded-pill border px-3 py-1 font-heading text-[11px] font-semibold transition-colors'
const CHIP_OFF = `${CHIP} border-border-default bg-surface-card text-text-secondary hover:border-brand-cyan hover:text-brand-navy`
const CHIP_ON = `${CHIP} border-brand-cyan bg-brand-cyan/10 text-brand-navy`

// The Design drawer's live preview: the real deployed page (shell) re-skinned
// with the DRAFT theme, so a chat commit shows up as soon as the sources are
// re-read — no deploy wait. Bumping `sourcesVersion` re-reads the theme only;
// a new `route` re-fetches the page; Refresh reloads both. Fully sandboxed, like ThemePreview.
export default function DesignPreviewPane({
  sessionId,
  route: pageRoute,
  sourcesVersion,
}: {
  sessionId: string
  route: string
  sourcesVersion: number
}) {
  // "Home" spot-check: every design change is site-wide, so one click shows it
  // on the homepage too. Keyed to the page it was chosen on, so selecting
  // another page returns to that page.
  const [homeFor, setHomeFor] = useState<string | null>(null)
  const showingHome = pageRoute !== '/' && homeFor === pageRoute
  const route = showingHome ? '/' : pageRoute
  const [viewport, setViewport] = useState<PreviewViewport>(PREVIEW_VIEWPORTS[0])
  const [shell, setShell] = useState<{ route: string; html: string } | null>(null)
  const [shellError, setShellError] = useState<{ message: string; wrongSite: boolean } | null>(null)
  const [sources, setSources] = useState<ThemeSources | null>(null)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const frameBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setShellError(null)
      const fetchShell = async (): Promise<ShellFetchResult> => {
        const res = await fetch(`/api/edit/${sessionId}/theme/shell?path=${encodeURIComponent(route)}`)
        if (res.ok) return { ok: true, shellHtml: ((await res.json()) as { shellHtml: string }).shellHtml }
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
        return { ok: false, status: res.status, error: data.error ?? `Couldn’t load the page (${res.status})`, code: data.code }
      }
      try {
        const { result } = await fetchShellWithRetry(fetchShell, undefined)
        if (cancelled) return
        if (result.ok) setShell({ route, html: result.shellHtml })
        else setShellError({ message: result.error, wrongSite: result.code === 'not_revaltus' })
      } catch {
        if (!cancelled) setShellError({ message: 'Couldn’t load the page', wrongSite: false })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId, route, refreshNonce])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/edit/${sessionId}/theme`)
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error ?? `Couldn’t load the theme (${res.status})`)
        }
        const next = (await res.json()) as ThemeSources
        if (cancelled) return
        setSources(next)
        setSourcesError(null)
      } catch (err) {
        if (!cancelled) setSourcesError(err instanceof Error ? err.message : 'Couldn’t load the theme')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sessionId, sourcesVersion, refreshNonce])

  useEffect(() => {
    const el = frameBox.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setBox({ width: r.width, height: r.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const srcDoc = useMemo(() => {
    if (!shell || shell.route !== route || !sources) return null
    return composePreviewSrcDoc({
      shellHtml: shell.html,
      themeCss: sources.themeCss,
      overridesCss: sources.overridesCss,
      typography: sources.typography,
      htmlAttributes: themeSourcesHtmlAttributes(sources),
    })
  }, [shell, route, sources])

  const scale = viewportScale(box.width, viewport.width)
  const frameWidth = Math.min(viewport.width, box.width > 0 ? box.width / scale : viewport.width)
  const frameHeight = box.height > 0 ? box.height / scale : viewport.height
  const error = shellError?.message ?? sourcesError

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface-subtle">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-default bg-surface-default px-4 py-2">
        <span className="font-heading text-xs font-semibold text-brand-navy">Draft preview</span>
        <span className="rounded-pill bg-surface-subtle px-2.5 py-0.5 font-body text-[11px] text-text-secondary">{route}</span>
        {pageRoute !== '/' && (
          <button
            type="button"
            aria-pressed={showingHome}
            onClick={() => setHomeFor(showingHome ? null : pageRoute)}
            title={showingHome ? `Back to ${pageRoute}` : 'Spot-check the change on the homepage'}
            className={showingHome ? CHIP_ON : CHIP_OFF}
          >
            {showingHome ? `← ${pageRoute}` : 'Check on Home'}
          </button>
        )}
        <div role="group" aria-label="Preview viewport" className="ml-auto flex items-center gap-1.5">
          {PREVIEW_VIEWPORTS.map((v) => (
            <button
              key={v.width}
              type="button"
              aria-pressed={viewport.width === v.width}
              onClick={() => setViewport(v)}
              className={viewport.width === v.width ? CHIP_ON : CHIP_OFF}
            >
              {v.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            title="Reload the page and the draft theme"
            className={CHIP_OFF}
          >
            Refresh
          </button>
        </div>
        <p className="w-full font-body text-[11px] text-text-muted">
          Design changes apply to every page. This is the live page re-skinned with the draft theme; unpublished content edits don’t show here.
        </p>
      </div>
      <div ref={frameBox} className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div
            role="alert"
            className={[
              'flex h-full items-center justify-center px-6 text-center font-body text-sm',
              shellError?.wrongSite ? 'text-warning-strong' : 'text-error',
            ].join(' ')}
          >
            {error}
          </div>
        ) : srcDoc ? (
          <iframe
            title={`Draft preview of ${route}`}
            srcDoc={srcDoc}
            // Fully sandboxed: the real-site HTML can neither run scripts nor
            // reach the app. External CSS, images and fonts still load.
            sandbox=""
            className="absolute top-0 border-0 bg-surface-card shadow-subtle"
            // Computed geometry only: the true viewport width, scaled to fit
            // and centred; the height fills the pane.
            style={{
              width: frameWidth,
              height: frameHeight,
              left: Math.max(0, (box.width - frameWidth * scale) / 2),
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-body text-sm text-text-muted">Loading the page…</div>
        )}
      </div>
    </div>
  )
}
