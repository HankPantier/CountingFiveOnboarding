import { NextResponse } from 'next/server'
import { resolveEditContext, type EditContext } from '../_helpers'
import { safePath } from '../_path'
import { contentPathToUrl, stripNavUrl } from '@/lib/editor/content-paths'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import {
  AssetExistsError,
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  deleteFile,
  ensureDraftBranch,
  moveFile,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

const NAV_PATH = 'content/nav.json'
const LIVE_ROOTS = ['content/pages/', 'content/posts/'] as const
const DRAFT_ROOTS = ['content/drafts/pages/', 'content/drafts/posts/'] as const

const author = (ctx: EditContext) => ({
  authorName: ctx.adminName ?? 'CountingFive Admin',
  authorEmail: ctx.adminEmail ?? 'admin@countingfive.com',
})

// Validate a client-supplied content path: traversal-safe AND under one of the
// allowed roots. Returns the normalized path or null.
function validContentPath(raw: string, roots: readonly string[]): string | null {
  const path = safePath(raw)
  if (!path || !path.endsWith('.md')) return null
  if (!roots.some((r) => path.startsWith(r))) return null
  return path
}

// Remove the page's nav.json link in a follow-up draft commit so the live nav
// never points at a missing page. Non-fatal: nav may be absent or unparseable.
async function stripNavReference(ctx: EditContext, contentPath: string): Promise<void> {
  const url = contentPathToUrl(contentPath)
  if (!url) return
  try {
    const nav = await readFile(ctx.githubRepo, NAV_PATH, DRAFT_BRANCH)
    const parsed = parseNavJson(nav.content)
    const { nav: next, changed } = stripNavUrl(parsed, url)
    if (!changed) return
    await writeFile(
      ctx.githubRepo,
      NAV_PATH,
      serializeNavJson(next),
      DRAFT_BRANCH,
      `Remove ${url} from navigation`,
      { expectedSha: nav.sha, ...author(ctx) }
    )
  } catch (err) {
    if (err instanceof FileNotFoundError) return
    console.warn(`[edit/page] nav strip skipped for ${contentPath}:`, err)
  }
}

type StateBody = {
  path?: string
  expectedSha?: string
  action?: 'draft' | 'restore'
}

// POST { path, expectedSha, action } — move a page between live and drafts.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: StateBody
  try {
    body = (await req.json()) as StateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { path: rawPath, expectedSha, action } = body
  if (!rawPath || typeof expectedSha !== 'string' || (action !== 'draft' && action !== 'restore')) {
    return NextResponse.json(
      { error: "path, expectedSha, and action ('draft'|'restore') required" },
      { status: 400 }
    )
  }

  const fromRoots = action === 'draft' ? LIVE_ROOTS : DRAFT_ROOTS
  const path = validContentPath(rawPath, fromRoots)
  if (!path) {
    return NextResponse.json(
      { error: `path must be a .md file under ${fromRoots.join(' or ')}` },
      { status: 400 }
    )
  }
  const newPath =
    action === 'draft'
      ? path.replace('content/', 'content/drafts/')
      : path.replace('content/drafts/', 'content/')

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await moveFile(
      ctx.githubRepo,
      path,
      newPath,
      DRAFT_BRANCH,
      expectedSha,
      `${action === 'draft' ? 'Unpublish' : 'Restore'} ${path.split('/').pop()} via admin (${
        ctx.adminEmail ?? 'unknown'
      })`,
      author(ctx)
    )
    // Drafting takes the page off the live site, so drop its nav link too.
    // Restore leaves nav alone — the admin re-links manually.
    if (action === 'draft') await stripNavReference(ctx, path)
    return NextResponse.json({ ...result, newPath })
  } catch (err) {
    return mapError(err)
  }
}

// DELETE ?path=...&sha=... — remove a page from the repo entirely.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path')
  const sha = url.searchParams.get('sha')
  if (!rawPath || !sha) {
    return NextResponse.json({ error: 'path and sha query params required' }, { status: 400 })
  }
  const path = validContentPath(rawPath, [...LIVE_ROOTS, ...DRAFT_ROOTS])
  if (!path) {
    return NextResponse.json(
      { error: 'path must be a .md content page' },
      { status: 400 }
    )
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await deleteFile(
      ctx.githubRepo,
      path,
      DRAFT_BRANCH,
      sha,
      `Delete ${path.split('/').pop()} via admin (${ctx.adminEmail ?? 'unknown'})`,
      author(ctx)
    )
    await stripNavReference(ctx, path)
    return NextResponse.json(result)
  } catch (err) {
    return mapError(err)
  }
}

function mapError(err: unknown): NextResponse {
  if (err instanceof FileNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 })
  }
  if (err instanceof AssetExistsError) {
    return NextResponse.json({ error: 'A page already exists at the destination.' }, { status: 409 })
  }
  if (err instanceof StaleShaError) {
    return NextResponse.json(
      { error: 'This page changed on the server. Reload to continue.' },
      { status: 409 }
    )
  }
  const message = err instanceof Error ? err.message : 'Unknown error'
  return NextResponse.json({ error: message }, { status: 500 })
}
