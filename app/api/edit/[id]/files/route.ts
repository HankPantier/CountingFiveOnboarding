import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { safePath } from '../_path'
import { reviewContentEdit } from '@/lib/content/content-edit-review'
import {
  DRAFT_BRANCH,
  StaleShaError,
  ensureDraftBranch,
  writeFile,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

type WriteBody = {
  path?: string
  contents?: string
  expectedSha?: string
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: WriteBody
  try {
    body = (await req.json()) as WriteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { path: rawPath, contents, expectedSha } = body
  if (!rawPath || typeof contents !== 'string') {
    return NextResponse.json(
      { error: 'path and contents required' },
      { status: 400 }
    )
  }
  const path = safePath(rawPath)
  if (!path) {
    return NextResponse.json({ error: 'path must be under content/' }, { status: 400 })
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await writeFile(
      ctx.githubRepo,
      path,
      contents,
      DRAFT_BRANCH,
      `Edit ${path.split('/').pop()} via admin${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
      {
        expectedSha,
        authorName: 'CountingFive Admin',
        authorEmail: ctx.adminEmail ?? 'admin@countingfive.com',
      }
    )
    reviewContentEdit(ctx.sessionId, path, contents)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json(
        {
          error: 'stale_sha',
          message: 'This file changed on the server. Reload to continue.',
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
