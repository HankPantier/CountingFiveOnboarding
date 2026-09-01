import { NextResponse } from 'next/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext, type EditContext } from '../_helpers'
import { denySiteOwnerConfig } from '@/lib/auth/access'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  ensureDraftBranch,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'
import {
  InvalidClientCenterJsonError,
  parseClientCenterJson,
  serializeClientCenterJson,
} from '@/lib/editor/client-center-config'
import type { ClientCenterJson } from '@/types/client-center'

export const runtime = 'nodejs'

const CLIENT_CENTER_PATH = 'content/client-center.json'

const EMPTY: ClientCenterJson = { enabled: false, label: 'Client Center', groups: [] }

const author = (ctx: EditContext) => ({
  authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name,
  authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
})

// GET — return the draft-branch client-center.json plus its blob sha (for
// optimistic-concurrency on save). A firm that never had portals has no file
// yet: return a disabled default with a null sha, which the editor writes fresh.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // Client-Center config is a staff-only surface — denied to Site Owners.
  const denied = denySiteOwnerConfig(ctx.user)
  if (denied) return denied

  try {
    const file = await readFile(ctx.githubRepo, CLIENT_CENTER_PATH, DRAFT_BRANCH)
    let config: ClientCenterJson
    try {
      config = parseClientCenterJson(file.content)
    } catch {
      // A hand-mangled file shouldn't brick the editor — fall back to empty but
      // keep the real sha so the operator's save overwrites it cleanly.
      config = EMPTY
    }
    return NextResponse.json({ config, sha: file.sha })
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ config: EMPTY, sha: null })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

type Body = { config?: unknown; expectedSha?: string | null }

// POST { config, expectedSha } — validate then write client-center.json to the
// draft branch. Goes live on the next Publish. No page-move/redirect logic: the
// links are external, and the nav button lives in the modal component, not nav.json.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const denied = denySiteOwnerConfig(ctx.user)
  if (denied) return denied

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let config: ClientCenterJson
  try {
    config = parseClientCenterJson(JSON.stringify(body.config))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof InvalidClientCenterJsonError ? err.message : 'Invalid config' },
      { status: 400 }
    )
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await writeFile(
      ctx.githubRepo,
      CLIENT_CENTER_PATH,
      serializeClientCenterJson(config),
      DRAFT_BRANCH,
      `Edit client-center.json via admin${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
      {
        ...(typeof body.expectedSha === 'string' ? { expectedSha: body.expectedSha } : {}),
        ...author(ctx),
      }
    )
    return NextResponse.json({ config, sha: result.blobSha, commitSha: result.commitSha })
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
