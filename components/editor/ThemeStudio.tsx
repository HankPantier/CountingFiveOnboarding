'use client'

import { useCallback, useEffect, useState } from 'react'
import ThemePreview from './ThemePreview'
import ThemeChat from './ThemeChat'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { gfUrl } from '@/lib/content/type-pairing-catalog'
import type { PaletteRole } from '@/lib/editor/theme-edit'
import type { ThemeSources, PreviewUrlInfo } from '@/app/api/edit/[id]/theme/_theme'

// Regenerate theme.css client-side (generateThemeCss is pure) so a color/font
// pick re-skins the preview instantly, before the draft commit round-trips.
function rebuildThemeCss(
  s: ThemeSources,
  palette: ThemeSources['palette'],
  typography: ThemeSources['typography']
): string {
  return generateThemeCss(
    { palette },
    {
      typography,
      roundness: s.roundness,
      density: s.density,
      visualFeel: s.visualFeel,
      spacing: s.spacing,
      radius: s.radius,
    }
  )
}

// Admin-only Theme Studio: a live 1:1 preview of the client's site (left) beside
// the AI theme assistant (right). The preview fetches a real deployed URL — the
// operator's override (e.g. a Vercel preview deploy before DNS cutover) or the
// canonical site.config.ts siteUrl — and re-skins it with the pending draft
// theme. Changes publish through the editor's existing Review changes → Publish.
export default function ThemeStudio({
  sessionId,
  pendingCount,
  publishing,
  canPublish,
  onPublish,
  onCommitted,
}: {
  sessionId: string
  // Draft commits ahead of live — how many changes are waiting to publish.
  pendingCount: number
  publishing: boolean
  canPublish: boolean
  onPublish: () => void
  // Called after the assistant commits a theme change, so the parent editor can
  // refresh its publish status / Review changes count.
  onCommitted: () => void
}) {
  const [info, setInfo] = useState<PreviewUrlInfo | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [sources, setSources] = useState<ThemeSources | null>(null)
  const [shellHtml, setShellHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyUrl, setBusyUrl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [contrastWarnings, setContrastWarnings] = useState<string[]>([])

  const loadSources = useCallback(async () => {
    const res = await fetch(`/api/edit/${sessionId}/theme`)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load theme (${res.status})`)
    }
    setSources((await res.json()) as ThemeSources)
  }, [sessionId])

  // Fetch the real-site shell (expensive external fetch) + theme sources. No-op
  // with a clear message when no preview URL is set yet.
  const loadPreview = useCallback(async () => {
    setError(null)
    setShellHtml(null)
    const shellRes = await fetch(`/api/edit/${sessionId}/theme/shell`)
    if (!shellRes.ok) {
      const data = (await shellRes.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load the preview (${shellRes.status})`)
    }
    const shell = (await shellRes.json()) as { shellHtml: string }
    setShellHtml(shell.shellHtml)
    await loadSources()
  }, [sessionId, loadSources])

  // Initial load: resolve the preview URL, then load the preview if one exists.
  const init = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/edit/${sessionId}/theme/preview-url`)
      if (!res.ok) throw new Error(`Failed to load preview settings (${res.status})`)
      const pi = (await res.json()) as PreviewUrlInfo
      setInfo(pi)
      setUrlInput(pi.effectiveUrl ?? '')
      if (pi.effectiveUrl) await loadPreview()
      else setError('No preview URL set. Enter the site URL above (e.g. https://acme.vercel.app) and load it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [sessionId, loadPreview])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void init()
  }, [init])

  // Save the preview-URL override (empty clears it → falls back to site.config),
  // then reload the preview against the new URL.
  const saveUrl = useCallback(
    async (value: string | null) => {
      setBusyUrl(true)
      setError(null)
      try {
        const res = await fetch(`/api/edit/${sessionId}/theme/preview-url`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ previewUrl: value }),
        })
        const data = (await res.json().catch(() => ({}))) as PreviewUrlInfo & { error?: string }
        if (!res.ok) throw new Error(data.error ?? `Failed to save (${res.status})`)
        setInfo(data)
        setUrlInput(data.effectiveUrl ?? '')
        if (data.effectiveUrl) await loadPreview()
        else {
          setShellHtml(null)
          setError('No preview URL set. Enter the site URL above and load it.')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save the preview URL')
      } finally {
        setBusyUrl(false)
      }
    },
    [sessionId, loadPreview]
  )

  // Commit a palette/typography change to the draft branch (+ MBP sync) via the
  // direct PATCH endpoint, then reconcile with the server's canonical sources.
  const commitTheme = useCallback(
    async (patch: { palette?: Partial<Record<PaletteRole, string>>; typography?: Record<string, string> }) => {
      setSaving(true)
      setSaveError(null)
      try {
        const res = await fetch(`/api/edit/${sessionId}/theme`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          contrastWarnings?: string[]
        }
        if (!res.ok) throw new Error(data.error ?? `Failed to save (${res.status})`)
        setContrastWarnings(Array.isArray(data.contrastWarnings) ? data.contrastWarnings : [])
        await loadSources().catch(() => {})
        onCommitted()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save theme change')
      } finally {
        setSaving(false)
      }
    },
    [sessionId, loadSources, onCommitted]
  )

  // Live (local) preview while dragging the picker — regenerate theme.css from
  // the new palette without a round-trip.
  const previewPalette = useCallback((role: PaletteRole, hex: string) => {
    setSources((s) => {
      if (!s) return s
      const palette = { ...s.palette, [role]: hex }
      return { ...s, palette, themeCss: rebuildThemeCss(s, palette, s.typography) }
    })
  }, [])

  const commitPalette = useCallback(
    (role: PaletteRole, hex: string) => void commitTheme({ palette: { [role]: hex } }),
    [commitTheme]
  )

  // Font change is discrete: preview instantly (new families + rebuilt fonts
  // URL) and commit in the same action.
  const changeFont = useCallback(
    (slot: 'headingFont' | 'bodyFont' | 'accentFont', font: string) => {
      setSources((s) => {
        if (!s) return s
        const typography = { ...s.typography, [slot]: font }
        typography.googleFontsUrl = gfUrl(
          Array.from(new Set([typography.headingFont, typography.bodyFont, typography.accentFont]))
        )
        return { ...s, typography, themeCss: rebuildThemeCss(s, s.palette, typography) }
      })
      void commitTheme({ typography: { [slot]: font } })
    },
    [commitTheme]
  )

  const overrideSet = !!info?.previewUrl
  const canResetToDefault = overrideSet && !!info?.configUrl && info.configUrl !== info.previewUrl

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-default px-6 py-2.5">
          <div className="min-w-0">
            <h1 className="font-heading text-sm font-semibold text-brand-navy">Theme &amp; styling</h1>
            <p className="font-body text-xs text-text-muted">
              Live preview. Click a color to pick a new one or choose fonts below — or ask the assistant for roundness, spacing, or a block&rsquo;s look. Then Publish.
            </p>
          </div>
          <button
            type="button"
            onClick={onPublish}
            disabled={!canPublish}
            title={
              pendingCount === 0
                ? 'Nothing new to publish'
                : 'Deploy your draft theme changes to the live site'
            }
            className="shrink-0 whitespace-nowrap rounded-pill bg-brand-navy px-4 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-navy-dark disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-muted"
          >
            {publishing ? 'Publishing…' : pendingCount > 0 ? `Publish to live (${pendingCount})` : 'Published'}
          </button>
        </div>

        {/* Preview URL bar — the deployed site to preview (a staging/Vercel URL
            before DNS cutover, or the canonical site.config siteUrl). */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void saveUrl(urlInput.trim() === '' ? null : urlInput.trim())
          }}
          className="flex flex-wrap items-center gap-2 border-b border-border-default bg-surface-subtle px-6 py-2"
        >
          <label htmlFor="preview-url" className="font-heading text-xs font-semibold text-text-secondary">
            Preview URL
          </label>
          <input
            id="preview-url"
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://acme.vercel.app"
            className="min-w-0 flex-1 rounded-pill border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs focus:border-brand-cyan focus:outline-none"
          />
          <button
            type="submit"
            disabled={busyUrl}
            className="rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:opacity-50"
          >
            {busyUrl ? 'Loading…' : 'Load preview'}
          </button>
          {canResetToDefault && (
            <button
              type="button"
              onClick={() => void saveUrl(null)}
              disabled={busyUrl}
              title={`Use the site's configured URL (${info?.configUrl})`}
              className="rounded-pill border border-border-default px-3 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-colors hover:text-brand-navy disabled:opacity-50"
            >
              Reset to default
            </button>
          )}
          <span className="w-full font-body text-[11px] text-text-muted">
            {overrideSet
              ? `Using a custom preview URL${info?.configUrl ? ` · site default: ${info.configUrl}` : ''}`
              : info?.configUrl
                ? `Using the site's configured URL. Enter a staging URL above to override it while you build.`
                : 'Set the deployed site URL to preview (e.g. a Vercel preview deploy).'}
          </span>
        </form>

        {loading ? (
          <div className="flex flex-1 items-center justify-center font-body text-sm text-text-muted">
            Loading the site…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center font-body text-sm text-error">
            {error}
          </div>
        ) : shellHtml && sources ? (
          <>
            {saveError && (
              <div className="border-b border-border-default bg-error/10 px-4 py-1.5 font-body text-[11px] text-error">
                {saveError}
              </div>
            )}
            <ThemePreview
              shellHtml={shellHtml}
              sources={sources}
              saving={saving}
              contrastWarnings={contrastWarnings}
              onPreviewPalette={previewPalette}
              onCommitPalette={commitPalette}
              onChangeFont={changeFont}
            />
          </>
        ) : null}
      </div>
      <div className="w-[360px] shrink-0">
        <ThemeChat
          sessionId={sessionId}
          onEdited={() => {
            // Refresh the preview AND the parent editor's publish status.
            void loadSources().catch(() => {})
            onCommitted()
          }}
        />
      </div>
    </div>
  )
}
