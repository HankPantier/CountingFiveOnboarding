import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'
import { loadDraftThemeSources } from '@/lib/design/theme-sources'
import { renderComposed } from '@/lib/design/render/render-composed'
import { RendererUnavailableError } from '@/lib/design/render/browser'
import type { ViewportKey } from '@/lib/design/render/harden'
import { toWebp, designStoragePath, storeDesignImage, signDesignPaths } from '@/lib/design/storage'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 120

interface RenderRequestBody {
  path?: string
  viewport?: string
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

  const body = (await req.json().catch(() => ({}))) as RenderRequestBody
  const viewport = (body.viewport ?? 'desktop') as ViewportKey
  if (viewport !== 'desktop' && viewport !== 'mobile') {
    return NextResponse.json({ error: 'viewport must be desktop or mobile.' }, { status: 400 })
  }

  try {
    const siteUrl = await getPreviewSiteUrl({ jobId: ctx.jobId, githubRepo: ctx.githubRepo })
    if (!siteUrl) return NextResponse.json({ error: 'No preview URL is set for this client.' }, { status: 409 })
    const page = resolvePreviewPageUrl(siteUrl, body.path ?? null)
    if (!page.ok) return NextResponse.json({ error: page.reason }, { status: 400 })

    const [shell, loaded] = await Promise.all([buildPreviewShell(page.url), loadDraftThemeSources(ctx.githubRepo)])
    if (!shell.ok) return NextResponse.json({ error: shell.reason }, { status: 502 })
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const { sources } = loaded

    const html = composePreviewSrcDoc({
      shellHtml: shell.shellHtml,
      themeCss: sources.themeCss,
      overridesCss: sources.overridesCss,
      typography: sources.typography,
      htmlAttributes: { 'data-headline': sources.headlineStyle, 'data-eyebrow': sources.eyebrowStyle },
    })

    const result = await renderComposed({ html, shellOrigin: shell.origin, viewport, crops: viewport === 'desktop' })

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
      timings: { ...result.timings, totalMs: Date.now() - started },
      blockedRequests: result.blockedRequests,
      shots: stored.map(({ path, ...rest }) => ({ ...rest, url: signed[path] })),
    })
  } catch (err) {
    if (err instanceof RendererUnavailableError) {
      return NextResponse.json({ error: 'The renderer is unavailable right now.' }, { status: 503 })
    }
    return internalError('design:render', err, 'Failed to render the page')
  }
}
