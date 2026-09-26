// Server-only. Fold renders for the Design Studio: the desktop (1440) and
// mobile (390) FOLD of one page, composed with a given theme, stored as WebP
// under any design folder — run renders use runs/{runId}, chat previews
// renders/chat — as design/{sessionId}/{folder…}/{name}-{viewport}.webp, a
// deterministic name uploaded with upsert so a retried render overwrites its
// own object instead of orphaning one. With `metrics: true` each viewport's
// in-page sample (taken in the same render page) is evaluated and combined
// into a RenderMetrics (kept even when a later viewport fails — its `viewports`
// list records which were measured; the apply gate warns about the others). The renderer is lazy-imported
// (playwright-core / @sparticuz/chromium are traced by path — see
// next.config.ts) and only ever driven through renderComposed(), which owns the
// single cached single-process page and its mutex. Never throws: failures come
// back as a readable, provider-free `error` alongside whatever was stored.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'
import { composeThemeDoc, type ComposedTheme } from '../composed-theme'
import { combineMetrics, evaluatePageSample, type RenderMetrics, type ViewportMetrics } from '../metrics'
import { designStoragePath, storeDesignImage, toWebp } from '../storage'
import type { RunScreenshot, RunViewport } from '../run-types'

export type RenderShell = { origin: string; shellHtml: string }
export type FoldRenderResult = { shots: RunScreenshot[]; desktopWebp: Buffer | null; metrics: RenderMetrics | null; error: string | null }

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

export type FoldRenderDetail = FoldRenderResult & { images: { viewport: RunViewport; webp: Buffer }[] }

// The general form: …/{folder…}/{name}-{viewport}.webp (upsert). `store:
// false` measures only (metrics: true) — no WebP, no upload — for a baseline
// the model never sees. `images` carries each stored fold's WebP bytes so a
// caller can hand them to a vision model without re-downloading.
export async function renderFoldsTo(args: {
  db: SupabaseClient<Database>
  sessionId: string
  folder: string[]
  name: string
  shell: RenderShell
  theme: ComposedTheme
  metrics?: boolean
  store?: boolean
}): Promise<FoldRenderDetail> {
  const store = args.store ?? true
  if (!isHttpsOrigin(args.shell.origin)) {
    return { shots: [], desktopWebp: null, metrics: null, error: 'The preview URL must use https to render.', images: [] }
  }

  let renderComposed: (typeof import('./render-composed'))['renderComposed']
  try {
    ;({ renderComposed } = await import('./render-composed'))
  } catch (err) {
    console.error('[design-run] failed to load the renderer', err)
    return { shots: [], desktopWebp: null, metrics: null, error: 'The renderer is unavailable right now.', images: [] }
  }

  const html = composeThemeDoc(args.shell.shellHtml, args.theme)
  const shots: RunScreenshot[] = []
  const images: FoldRenderDetail['images'] = []
  const measured: ViewportMetrics[] = []
  let desktopWebp: Buffer | null = null
  for (const viewport of VIEWPORTS) {
    try {
      const result = await renderComposed({ html, shellOrigin: args.shell.origin, viewport, crops: false, ...(args.metrics ? { metrics: true } : {}) })
      if (args.metrics && result.sample) measured.push(evaluatePageSample(viewport, result.sample))
      const fold = result.shots.find((s) => s.kind === 'fold')
      if (!fold || !store) continue
      const { webp, width, height } = await toWebp(fold.png)
      const path = designStoragePath(args.sessionId, ...args.folder, `${args.name}-${viewport}.webp`)
      await storeDesignImage(args.db, path, webp, { upsert: true })
      shots.push({ viewport, path, width, height })
      images.push({ viewport, webp })
      if (viewport === 'desktop') desktopWebp = webp
    } catch (err) {
      console.error(`[design-run] ${viewport} render failed for ${args.name}`, err)
      return { shots, desktopWebp, metrics: combineMetrics(measured), error: renderErrorMessage(err), images }
    }
  }
  return { shots, desktopWebp, metrics: combineMetrics(measured), error: null, images }
}

// Run renders (P3/P4): design/{sid}/runs/{runId}/{name}-{viewport}.webp.
// `name` is deterministic per run ('current', 'concept-{p}-r{i}'), so a
// re-render UPSERTS its own object.
export async function renderAndStoreFolds(args: {
  db: SupabaseClient<Database>
  sessionId: string
  runId: string
  name: string
  shell: RenderShell
  theme: ComposedTheme
  metrics?: boolean
}): Promise<FoldRenderResult> {
  const { runId, ...rest } = args
  const { images: _images, ...result } = await renderFoldsTo({ ...rest, folder: ['runs', runId] })
  return result
}
