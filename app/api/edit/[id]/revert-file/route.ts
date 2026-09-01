import { NextResponse } from 'next/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../_helpers'
import { safePath, safeAssetPath } from '../_path'
import { StaleShaError, revertFileToMain } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

type Body = { path?: string; expectedSha?: string }

// POST { path, expectedSha } — undo one file's unpublished changes by making
// the draft copy match live. The change list can include content/ files and
// image assets under public/, so accept either root. expectedSha optimistically
// locks against the draft blob the caller last saw.
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
  const { path: rawPath, expectedSha } = body
  if (!rawPath) {
    return NextResponse.json({ error: 'path required' }, { status: 400 })
  }
  const path = safePath(rawPath) ?? safeAssetPath(rawPath)
  if (!path) {
    return NextResponse.json(
      { error: 'path must be under content/ or a public asset root' },
      { status: 400 }
    )
  }

  try {
    const result = await revertFileToMain(ctx.githubRepo, path, expectedSha ?? '', {
      authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name,
      authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
    })
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
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
