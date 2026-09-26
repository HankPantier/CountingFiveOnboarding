import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../_helpers'
import { safePath, CONTENT_MD_RE, ADMIN_BLOCKED_CONFIG } from '../_path'
import { reviewContentEdit } from '@/lib/content/content-edit-review'
import { validateFrontmatterYaml } from '@/lib/editor/frontmatter-yaml'
import {
  DRAFT_BRANCH,
  StaleShaError,
  ensureDraftBranch,
  writeFile,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

// Non-admins may write page/post markdown only (CONTENT_MD_RE). Admins
// (superusers) may still raw-edit other content/ files from the code view,
// EXCEPT ADMIN_BLOCKED_CONFIG (nav.json).

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
  const isContentMd = CONTENT_MD_RE.test(path)
  if (!isContentMd && (!ctx.user.isAdmin || ADMIN_BLOCKED_CONFIG.has(path))) {
    return NextResponse.json(
      { error: 'This file is site configuration and must be edited from its own settings panel.' },
      { status: 403 }
    )
  }
  if (path.endsWith('.md')) {
    // Same guard the AI editor applies at commit time: invalid YAML frontmatter
    // hard-fails the site's `next build`, so refuse it before it reaches draft.
    const yamlError = validateFrontmatterYaml(contents)
    if (yamlError) return NextResponse.json({ error: yamlError }, { status: 422 })
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
        authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name,
        authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
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
    return internalError('edit:files', err, "Couldn't save the file")
  }
}
