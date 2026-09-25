import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'
import { loadDraftThemeSources } from '@/lib/design/theme-sources'
import type { ViewportKey } from '@/lib/design/render/harden'
import { toWebp, designStoragePath, storeDesignImage, signDesignPaths } from '@/lib/design/storage'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 120

function isHttpsOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'https:'
  } catch {
    return false
  }
}

interface RenderRequestBody {
  path?: string
  viewport?: string
  // Desktop renders add up to 3 block crops by default; false skips them
  // (the chat's "Screenshot the draft" only needs the fold — PF11).
  crops?: boolean
}

// POST — render one page of the client's site with the DRAFT theme applied
// (live page shell + draft theme.css/overrides + treatment attributes) in
// headless Chromium; store WebP screenshots under design/{sessionId}/renders/
// and return short-lived signed URLs. Admin-only. The Design Studio critique
// loop (P4) and chat render_preview tool (P5) build on this.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = Date.now()
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  let body: RenderRequestBody
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    body = parsed as RenderRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const viewport = (body.viewport ?? 'desktop') as ViewportKey
  if (viewport !== 'desktop' && viewport !== 'mobile') {
    return NextResponse.json({ error: 'viewport must be desktop or mobile.' }, { status: 400 })
  }

  // Loaded lazily (not at module top-level): the renderer pulls in
  // playwright-core / @sparticuz/chromium, both native/traced-by-path
  // dependencies. A module-load failure here (e.g. an untraced file) fails
  // ONE request with a typed 503 instead of crashing the whole route module
  // at cold start, which Vercel surfaces as an untyped 500 with no JSON body.
  let renderComposed: (typeof import('@/lib/design/render/render-composed'))['renderComposed']
  let RendererUnavailableError: (typeof import('@/lib/design/render/browser'))['RendererUnavailableError']
  try {
    const [renderModule, browserModule] = await Promise.all([
      import('@/lib/design/render/render-composed'),
      import('@/lib/design/render/browser'),
    ])
    renderComposed = renderModule.renderComposed
    RendererUnavailableError = browserModule.RendererUnavailableError
  } catch (err) {
    console.error('[design-render] failed to load the renderer', err)
    return NextResponse.json({ error: 'The renderer is unavailable right now.' }, { status: 503 })
  }

  try {
    const siteUrl = await getPreviewSiteUrl({ jobId: ctx.jobId, githubRepo: ctx.githubRepo })
    if (!siteUrl) return NextResponse.json({ error: 'No preview URL is set for this client.' }, { status: 409 })
    const page = resolvePreviewPageUrl(siteUrl, body.path ?? null)
    if (!page.ok) return NextResponse.json({ error: page.reason }, { status: 400 })

    const [shell, loaded] = await Promise.all([buildPreviewShell(page.url), loadDraftThemeSources(ctx.githubRepo)])
    if (!shell.ok) return NextResponse.json({ error: shell.reason }, { status: 502 })
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    // The renderer's request allowlist and CSP only admit https — an http
    // shell would render with every same-origin asset blocked.
    if (!isHttpsOrigin(shell.origin)) {
      return NextResponse.json({ error: 'The preview URL must use https to render.' }, { status: 422 })
    }
    const { sources } = loaded

    const html = composePreviewSrcDoc({
      shellHtml: shell.shellHtml,
      themeCss: sources.themeCss,
      overridesCss: sources.overridesCss,
      typography: sources.typography,
      htmlAttributes: { 'data-headline': sources.headlineStyle, 'data-eyebrow': sources.eyebrowStyle },
    })

    const result = await renderComposed({ html, shellOrigin: shell.origin, viewport, crops: viewport === 'desktop' && body.crops !== false })

    const supabase = createServerClient()
    const renderId = randomUUID()
    const stored = await Promise.all(
      result.shots.map(async (shot, i) => {
        const { webp, width, height } = await toWebp(shot.png)
        const path = designStoragePath(ctx.sessionId, 'renders', `${renderId}-${viewport}-${i}.webp`)
        await storeDesignImage(supabase, path, webp)
        return { kind: shot.kind, selector: shot.selector, width, height, path }
      })
    )
    const signed = await signDesignPaths(supabase, stored.map((s) => s.path))

    return NextResponse.json({
      renderId,
      path: page.path,
      viewport,
      timings: { ...result.timings, totalMs: Date.now() - started, steps: result.steps },
      blockedRequests: result.blockedRequests,
      shots: stored.map(({ path, ...rest }) => ({ ...rest, url: signed[path] })),
    })
  } catch (err) {
    if (err instanceof RendererUnavailableError) {
      return NextResponse.json({ error: 'The renderer is unavailable right now.' }, { status: 503 })
    }
    // Checked by name, not `instanceof RenderTimeoutError` — that class isn't
    // imported here at all (the renderer module above is loaded lazily, and
    // a name check avoids needing yet another lazily-loaded symbol just for
    // this comparison; see lib/design/render/browser.ts).
    if (err instanceof Error && err.name === 'RenderTimeoutError') {
      return NextResponse.json({ error: 'The render timed out.' }, { status: 504 })
    }
    return internalError('design:render', err, 'Failed to render the page')
  }
}
