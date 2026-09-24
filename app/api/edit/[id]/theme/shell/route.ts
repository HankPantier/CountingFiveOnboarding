import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET a re-skinnable shell of the client's REAL deployed site (homepage) for the
// Theme Studio preview. Admin-only. Fetched once per studio session; the client
// re-skins it locally as the theme sources change. The deployed host comes from
// site.config.ts on MAIN (the live site), never client input.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo } = ctx

  const user = ctx.user
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const siteUrl = await getPreviewSiteUrl({ jobId: ctx.jobId, githubRepo })
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'No preview URL is set for this client. Add one above to preview the site.' },
      { status: 409 }
    )
  }

  // Optional ?path= previews another page of the same site (Design Studio
  // multi-page preview). Decoded + same-origin checked before any fetch.
  const page = resolvePreviewPageUrl(siteUrl, new URL(req.url).searchParams.get('path'))
  if (!page.ok) return NextResponse.json({ error: page.reason }, { status: 400 })

  const shell = await buildPreviewShell(page.url)
  if (!shell.ok) {
    return NextResponse.json({ error: shell.reason }, { status: 502 })
  }
  return NextResponse.json({ origin: shell.origin, shellHtml: shell.shellHtml, path: page.path })
}
