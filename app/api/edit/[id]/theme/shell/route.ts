import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { getCurrentUser } from '@/lib/auth/access'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'

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

  const user = await getCurrentUser()
  if (!user || !user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const siteUrl = await readSiteConfigSiteUrl(githubRepo, MAIN_BRANCH)
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'No published site URL is set for this client, so the live preview is unavailable.' },
      { status: 409 }
    )
  }

  const shell = await buildPreviewShell(siteUrl)
  if (!shell.ok) {
    return NextResponse.json({ error: shell.reason }, { status: 502 })
  }
  return NextResponse.json({ origin: shell.origin, shellHtml: shell.shellHtml })
}
