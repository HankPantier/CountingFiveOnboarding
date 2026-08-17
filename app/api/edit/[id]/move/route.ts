import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { safePath } from '../_path'
import { contentPathToUrl, urlToContentPath } from '@/lib/editor/content-paths'
import { lastSegment } from '@/lib/editor/nav-urls'
import { DestinationOccupiedError, relocateFile } from '@/lib/editor/relocate'
import { appendNavItem, retargetNavUrl, stripNavReference } from '@/lib/editor/nav-mutations'
import { DRAFT_BRANCH, StaleShaError, ensureDraftBranch, listTree } from '@/lib/github/repo-files'

export const runtime = 'nodejs'

const CONTENT_ROOTS = ['content/pages/', 'content/posts/'] as const
const NAV_ACTIONS = ['retarget', 'remove', 'add', 'none'] as const
type NavAction = (typeof NAV_ACTIONS)[number]

interface Body {
  fromPath?: string
  toUrl?: string
  expectedSha?: string
  navAction?: NavAction
  navLabel?: string
  navParentUrl?: string
}

// A model/client-supplied source path must be traversal-safe AND a live .md page.
function validFromPath(raw: string): string | null {
  const path = safePath(raw)
  if (!path || !path.endsWith('.md')) return null
  if (!CONTENT_ROOTS.some((r) => path.startsWith(r))) return null
  return path
}

// Title-case a url's last slug into a default nav label ("/services/tax" → "Tax").
function labelFromUrl(url: string): string {
  const seg = lastSegment(url)
  const label = seg
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim()
  return label || 'Page'
}

// True when a page has descendant pages (services--tax under services). Moving
// such a parent would orphan its children, so the route refuses it. Posts are
// flat and never have descendants.
async function hasDescendantPages(repo: string, fromPath: string): Promise<boolean> {
  const m = /^content\/pages\/(.+)\.md$/.exec(fromPath)
  if (!m) return false
  const prefix = m[1] + '--'
  const entries = await listTree(repo, DRAFT_BRANCH, 'content/pages/')
  return entries.some(
    (e) =>
      e.type === 'blob' &&
      e.path.endsWith('.md') &&
      e.path !== fromPath &&
      e.path.slice('content/pages/'.length).startsWith(prefix)
  )
}

// POST { fromPath, toUrl, expectedSha, navAction } — relocate a content file
// (page ↔ resource/post, or reparent a page) on the draft branch, updating its
// canonical, adding a 301, and syncing its nav link. Goes live on next Publish.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const navAction: NavAction = NAV_ACTIONS.includes(body.navAction as NavAction)
    ? (body.navAction as NavAction)
    : 'retarget'
  if (typeof body.fromPath !== 'string' || typeof body.toUrl !== 'string') {
    return NextResponse.json({ error: 'fromPath and toUrl are required' }, { status: 400 })
  }

  const fromPath = validFromPath(body.fromPath)
  if (!fromPath) {
    return NextResponse.json(
      { error: 'fromPath must be a .md file under content/pages or content/posts' },
      { status: 400 }
    )
  }
  const fromUrl = contentPathToUrl(fromPath)
  if (!fromUrl) {
    return NextResponse.json({ error: 'Could not resolve the current page URL' }, { status: 400 })
  }

  const toPath = urlToContentPath(body.toUrl)
  if (!toPath) {
    return NextResponse.json(
      { error: 'Invalid destination — the home page and external URLs cannot be targeted' },
      { status: 400 }
    )
  }
  // Canonicalize the destination url from its resolved path (normalizes slashes).
  const toUrl = contentPathToUrl(toPath) as string

  const willMove = fromPath !== toPath
  if (!willMove && navAction !== 'add') {
    return NextResponse.json(
      { error: 'Source and destination are the same' },
      { status: 400 }
    )
  }
  if (willMove && typeof body.expectedSha !== 'string') {
    return NextResponse.json({ error: 'expectedSha is required to move a file' }, { status: 400 })
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)

    let moved = false
    let blobSha = body.expectedSha ?? ''
    if (willMove) {
      if (await hasDescendantPages(ctx.githubRepo, fromPath)) {
        return NextResponse.json(
          { error: 'This page has sub-pages nested under it — move or delete those first.' },
          { status: 409 }
        )
      }
      const res = await relocateFile(ctx, {
        fromPath,
        toPath,
        fromUrl,
        toUrl,
        expectedSha: body.expectedSha as string,
        reason: 'Relocated via editor',
      })
      moved = res.moved
      blobSha = res.blobSha
    }

    if (navAction === 'retarget') {
      await retargetNavUrl(ctx, fromUrl, toUrl)
    } else if (navAction === 'remove') {
      // stripNavReference maps the (old) path back to fromUrl and removes it —
      // used for → Resources, where posts surface on the index, not the top nav.
      await stripNavReference(ctx, fromPath)
    } else if (navAction === 'add') {
      const label = body.navLabel?.trim() || labelFromUrl(toUrl)
      await appendNavItem(ctx, label, toUrl, body.navParentUrl?.trim() || undefined)
    }

    return NextResponse.json({ fromUrl, toUrl, toPath, moved, blobSha })
  } catch (err) {
    if (err instanceof DestinationOccupiedError) {
      return NextResponse.json(
        { error: err.message, collision: { from: err.from, to: err.to } },
        { status: 422 }
      )
    }
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
