// Server-only (renderer via render-folds). One design-chat preview: the
// working copy's desktop + mobile folds on the chosen page, stored at
// design/{sid}/renders/chat/{turnId}-p{n}-{viewport}.webp (upsert) with signed
// URLs, the WebP bytes for the model, and render metrics. The render checks
// are baseline-diffed against the TURN-START draft on the same page (P4
// semantics: a defect the site already has never blocks), measured once per
// (session, theme blobs, page) — measure-only, never stored, never shown to
// the model — and cached in-process.
//
// Time (PF1): every render is bounded by RENDER_DEADLINE_MS, so a preview
// costs 2 renders when the baseline is cached and 4 when it isn't. The tool
// checks chatPreviewRenderMs(isChatBaselineCached(…)) + CHAT_COMMIT_RESERVE_MS
// against the turn's remaining time before calling; renderChatPreview re-checks
// after the page-shell fetch when given `turnDeadlineAt`.
//
// Never throws (PF4): every failure — shell fetch, renderer, storage, signing —
// comes back as `error` in our own words, never provider/GitHub/storage text.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { MALFORMED_REGION_ERROR, type RenderedThemeFiles } from './bundle-files'
import type { PreviewShot } from './chat-types'
import { composedThemeFromFiles, type ComposedTheme } from './composed-theme'
import { THEME_FILE_PATHS } from './drift'
import type { RenderMetrics } from './metrics'
import { loadRenderShell, renderFoldsTo } from './render/render-folds'
import { RENDER_DEADLINE_MS, type RunViewport } from './run-types'
import { signDesignPaths } from './storage'
import type { ThemeBlobShas } from './studio-types'

export type ChatPreviewTarget = { sessionId: string; jobId: string; githubRepo: string }
export type ChatPreviewResult = {
  shots: PreviewShot[]
  images: { viewport: RunViewport; webp: Buffer }[]
  metrics: RenderMetrics | null
  baseline: RenderMetrics | null
  error: string | null
}

export const CHAT_COMMIT_RESERVE_MS = 45_000
export const CHAT_PREVIEW_NO_TIME_ERROR =
  'There isn’t enough time left in this turn to render a preview and still save — commit the change now (it will be saved with a “not previewed” warning) or preview it next turn.'
export const CHAT_PREVIEW_FAILED_ERROR = 'The preview could not be rendered.'
const SHELL_FAILED_ERROR = 'The live page could not be loaded for a preview.'
const MALFORMED_PREVIEW_ERROR =
  'The site’s content/design-overrides.css has malformed design-studio region markers, so the working copy can’t be previewed or saved from the chat — the file has to be fixed by hand first.'
const RENDERED_FILES_ERROR = 'The working copy could not be turned into theme files, so it can’t be previewed.'

// Worst-case wall time of one preview: 2 fold renders, plus 2 more to measure
// the baseline when it isn't cached.
export function chatPreviewRenderMs(baselineCached: boolean): number {
  return (baselineCached ? 2 : 4) * RENDER_DEADLINE_MS
}

// Whether a preview started at `now` would still leave the commit reserve.
export function chatPreviewFits(args: { now: number; turnDeadlineAt: number; baselineCached: boolean }): boolean {
  return args.now + chatPreviewRenderMs(args.baselineCached) + CHAT_COMMIT_RESERVE_MS <= args.turnDeadlineAt
}

const PREVIEW_FOLDER = ['renders', 'chat']
const BASELINE_CACHE_MAX = 32
const baselineCache = new Map<string, RenderMetrics>()

export function __resetChatBaselineCacheForTests(): void {
  baselineCache.clear()
}

// Keyed by the page as the caller asked for it (so the tool can ask
// isChatBaselineCached before any network call); a differently-spelled path to
// the same page only costs an extra measurement. Scoped to the session: two
// clients can share identical theme blobs but never a preview site.
export function baselineCacheKey(shas: ThemeBlobShas, pagePath: string, sessionId = ''): string {
  return `${sessionId}|${THEME_FILE_PATHS.map((p) => shas[p] ?? '-').join(':')}|${pagePath}`
}

export function isChatBaselineCached(sessionId: string, shas: ThemeBlobShas, pagePath: string): boolean {
  return baselineCache.has(baselineCacheKey(shas, pagePath, sessionId))
}

function remember(key: string, metrics: RenderMetrics): void {
  if (baselineCache.size >= BASELINE_CACHE_MAX) {
    const oldest = baselineCache.keys().next().value
    if (oldest !== undefined) baselineCache.delete(oldest)
  }
  baselineCache.set(key, metrics)
}

// The working copy's theme for a preview, from ChatWorkspace.renderedFiles().
// A malformed overrides region (renderedFiles uses removeLegacy: false) or any
// other failure becomes a typed preview error in our own words.
export function chatPreviewTheme(
  rendered: { ok: true; files: RenderedThemeFiles } | { ok: false; errors: string[] }
): { ok: true; theme: ComposedTheme } | { ok: false; error: string } {
  if (!rendered.ok) return { ok: false, error: rendered.errors.includes(MALFORMED_REGION_ERROR) ? MALFORMED_PREVIEW_ERROR : RENDERED_FILES_ERROR }
  try {
    return { ok: true, theme: composedThemeFromFiles(rendered.files) }
  } catch (err) {
    console.error('[design-chat] composing the preview theme failed', err)
    return { ok: false, error: RENDERED_FILES_ERROR }
  }
}

const failed = (error: string, baseline: RenderMetrics | null = null): ChatPreviewResult => ({ shots: [], images: [], metrics: null, baseline, error })

export async function renderChatPreview(args: {
  db: SupabaseClient<Database>
  target: ChatPreviewTarget
  turnId: string
  previewNo: number
  page: string
  theme: ComposedTheme
  baselineTheme: ComposedTheme
  baselineShas: ThemeBlobShas
  // Absolute epoch ms the turn must end by; when set, a preview that would
  // eat CHAT_COMMIT_RESERVE_MS is refused (after the shell fetch).
  turnDeadlineAt?: number
}): Promise<ChatPreviewResult> {
  let loaded: Awaited<ReturnType<typeof loadRenderShell>>
  try {
    loaded = await loadRenderShell(args.target, args.page)
  } catch (err) {
    console.error('[design-chat] preview shell load failed', err)
    return failed(SHELL_FAILED_ERROR)
  }
  if (!loaded.ok) return failed(loaded.reason)

  const key = baselineCacheKey(args.baselineShas, args.page, args.target.sessionId)
  let baseline = baselineCache.get(key) ?? null
  if (args.turnDeadlineAt !== undefined && !chatPreviewFits({ now: Date.now(), turnDeadlineAt: args.turnDeadlineAt, baselineCached: baseline !== null })) {
    return failed(CHAT_PREVIEW_NO_TIME_ERROR)
  }

  try {
    if (!baseline) {
      const measured = await renderFoldsTo({
        db: args.db,
        sessionId: args.target.sessionId,
        folder: PREVIEW_FOLDER,
        name: 'baseline',
        shell: loaded.shell,
        theme: args.baselineTheme,
        metrics: true,
        store: false,
      })
      baseline = measured.metrics
      // Only a complete baseline is cached; a partial one is retried next time.
      if (baseline && baseline.viewports.length === 2) remember(key, baseline)
    }

    const r = await renderFoldsTo({
      db: args.db,
      sessionId: args.target.sessionId,
      folder: PREVIEW_FOLDER,
      name: `${args.turnId}-p${args.previewNo}`,
      shell: loaded.shell,
      theme: args.theme,
      metrics: true,
    })
    let signed: Record<string, string> = {}
    try {
      signed = await signDesignPaths(args.db, r.shots.map((s) => s.path))
    } catch (err) {
      console.warn('[design-chat] preview signing failed:', err)
    }
    return {
      shots: r.shots.map((s) => ({ ...s, url: signed[s.path] ?? null })),
      images: r.images,
      metrics: r.metrics,
      baseline,
      error: r.error,
    }
  } catch (err) {
    console.error('[design-chat] preview render failed', err)
    return failed(CHAT_PREVIEW_FAILED_ERROR, baseline)
  }
}
