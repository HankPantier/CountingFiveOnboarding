import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../_helpers'
import { safePath, safeAssetPath, CONTENT_MD_RE, ADMIN_BLOCKED_CONFIG } from '../_path'
import { StaleShaError, revertFileToMain } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

type Body = { path?: string; expectedSha?: string; previousPath?: string | null }

// Same lockdown as the files route: non-admins (editors, Site Owners) may only
// revert page/post markdown and media; site config (brand/design/theme/
// client-center/redirects) is admin-only, and nav.json is never reverted raw.
function mayRevert(path: string, isAdmin: boolean): boolean {
  if (ADMIN_BLOCKED_CONFIG.has(path)) return false
  if (CONTENT_MD_RE.test(path) || safeAssetPath(path) === path) return true
  return isAdmin
}

function normalizeRevertPath(raw: string): string | null {
  return safePath(raw) ?? safeAssetPath(raw)
}

// POST { path, expectedSha, previousPath? } — undo one file's unpublished
// changes by making the draft copy match live. The change list can include
// content/ files and image assets under public/, so accept either root.
// expectedSha optimistically locks against the draft blob the caller last saw.
// previousPath (a 'renamed' entry's old name) reverts both sides of the rename
// in one commit, so the undo restores the page instead of deleting it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { path: rawPath, expectedSha, previousPath: rawPrevious } = body
  if (!rawPath || typeof rawPath !== 'string') {
    return NextResponse.json({ error: 'path required' }, { status: 400 })
  }
  const path = normalizeRevertPath(rawPath)
  const previousPath =
    rawPrevious == null || rawPrevious === '' ? null
      : typeof rawPrevious === 'string' ? normalizeRevertPath(rawPrevious)
      : undefined
  if (!path || previousPath === undefined || (rawPrevious && !previousPath)) {
    return NextResponse.json(
      { error: 'path must be under content/ or a public asset root' },
      { status: 400 }
    )
  }
  if (!mayRevert(path, ctx.user.isAdmin) || (previousPath && !mayRevert(previousPath, ctx.user.isAdmin))) {
    return NextResponse.json(
      { error: 'This file is site configuration and must be changed from its own settings panel.' },
      { status: 403 }
    )
  }

  try {
    const result = await revertFileToMain(
      ctx.githubRepo,
      path,
      expectedSha ?? '',
      {
        authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name,
        authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
      },
      previousPath
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json(
        {
          error: 'stale_sha',
          message:
            'This file changed on the server since you loaded the changes list. Refresh and try again.',
          currentSha: err.currentSha,
          currentContent: err.currentContent,
        },
        { status: 409 }
      )
    }
    return internalError('edit:revert-file', err, "Couldn't revert the file")
  }
}
