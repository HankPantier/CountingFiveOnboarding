// Server-only. Run renders for the Design Studio: the desktop (1440) and
// mobile (390) FOLD of one page, composed with a given theme, stored as WebP
// under design/{sessionId}/runs/{runId}/. The renderer is lazy-imported
// (playwright-core / @sparticuz/chromium are traced by path — see
// next.config.ts) and only ever driven through renderComposed(), which owns the
// single cached single-process page and its mutex. Never throws: failures come
// back as a readable, provider-free `error` alongside whatever was stored.
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'
import { composeThemeDoc, type ComposedTheme } from '../composed-theme'
import { designStoragePath, storeDesignImage, toWebp } from '../storage'
import type { RunScreenshot, RunViewport } from '../run-types'

export type RenderShell = { origin: string; shellHtml: string }
export type FoldRenderResult = { shots: RunScreenshot[]; desktopWebp: Buffer | null; error: string | null }

const VIEWPORTS: RunViewport[] = ['desktop', 'mobile']

function isHttpsOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'https:'
  } catch {
    return false
  }
}

export function renderErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'RendererUnavailableError') return 'The renderer is unavailable right now.'
  if (name === 'RenderTimeoutError') return 'The render timed out.'
  return 'The render failed.'
}

export async function loadRenderShell(
  target: { jobId: string; githubRepo: string },
  pagePath: string
): Promise<{ ok: true; shell: RenderShell; path: string } | { ok: false; reason: string }> {
  const siteUrl = await getPreviewSiteUrl(target)
  if (!siteUrl) return { ok: false, reason: 'No preview URL is set for this client.' }
  const page = resolvePreviewPageUrl(siteUrl, pagePath)
  if (!page.ok) return { ok: false, reason: page.reason }
  const shell = await buildPreviewShell(page.url)
  if (!shell.ok) return { ok: false, reason: shell.reason }
  return { ok: true, shell: { origin: shell.origin, shellHtml: shell.shellHtml }, path: page.path }
}

export async function renderAndStoreFolds(args: {
  db: SupabaseClient<Database>
  sessionId: string
  runId: string
  name: string
  shell: RenderShell
  theme: ComposedTheme
}): Promise<FoldRenderResult> {
  if (!isHttpsOrigin(args.shell.origin)) return { shots: [], desktopWebp: null, error: 'The preview URL must use https to render.' }

  let renderComposed: (typeof import('./render-composed'))['renderComposed']
  try {
    ;({ renderComposed } = await import('./render-composed'))
  } catch (err) {
    console.error('[design-run] failed to load the renderer', err)
    return { shots: [], desktopWebp: null, error: 'The renderer is unavailable right now.' }
  }

  const html = composeThemeDoc(args.shell.shellHtml, args.theme)
  const shots: RunScreenshot[] = []
  let desktopWebp: Buffer | null = null
  for (const viewport of VIEWPORTS) {
    try {
      const result = await renderComposed({ html, shellOrigin: args.shell.origin, viewport, crops: false })
      const fold = result.shots.find((s) => s.kind === 'fold')
      if (!fold) continue
      const { webp, width, height } = await toWebp(fold.png)
      const path = designStoragePath(args.sessionId, 'runs', args.runId, `${args.name}-${viewport}-${randomUUID().slice(0, 8)}.webp`)
      await storeDesignImage(args.db, path, webp)
      shots.push({ viewport, path, width, height })
      if (viewport === 'desktop') desktopWebp = webp
    } catch (err) {
      console.error(`[design-run] ${viewport} render failed for ${args.name}`, err)
      return { shots, desktopWebp, error: renderErrorMessage(err) }
    }
  }
  return { shots, desktopWebp, error: null }
}
