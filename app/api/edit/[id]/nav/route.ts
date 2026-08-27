import { NextResponse } from 'next/server'
import { resolveEditContext, type EditContext } from '../_helpers'
import { safePath } from '../_path'
import { denySiteOwnerConfig } from '@/lib/auth/access'
import { parseNavJson } from '@/lib/editor/nav-config'
import { orderMoves, toPathname } from '@/lib/editor/nav-urls'
import {
  appendRedirects,
  frontmatterUrl,
  swapFrontmatterUrl,
} from '@/lib/editor/relocate'
import {
  AssetExistsError,
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  ensureDraftBranch,
  moveFile,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

const NAV_PATH = 'content/nav.json'

type Move = { from: string; to: string }
type Body = { contents?: string; moves?: Move[]; expectedSha?: string }

const author = (ctx: EditContext) => ({
  authorName: ctx.adminName ?? 'CountingFive Admin',
  authorEmail: ctx.adminEmail ?? 'admin@countingfive.com',
})

// Root-relative page url → repo path, traversal-checked. Null for non-page urls.
function pagePath(url: string): string | null {
  if (!url.startsWith('/')) return null
  const slug = url.replace(/^\/+|\/+$/g, '')
  if (!slug) return null
  return safePath('content/pages/' + slug.replace(/\//g, '--') + '.md')
}

// POST { contents, moves, expectedSha } — save nav.json AND relocate any page
// whose nav url changed (from → to), adding a 301 for each. All on the draft
// branch; goes live on the next Publish.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // Nav editing (page relocation + 301s) is a config surface — denied to Site
  // Owners even for their own site (CLAUDE.md rule 6).
  const denied = denySiteOwnerConfig(ctx.user)
  if (denied) return denied

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { contents, moves = [], expectedSha } = body
  if (typeof contents !== 'string' || typeof expectedSha !== 'string') {
    return NextResponse.json({ error: 'contents and expectedSha required' }, { status: 400 })
  }
  try {
    parseNavJson(contents)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid nav.json' },
      { status: 400 }
    )
  }

  // Normalize to root-relative paths so absolute, host-prefixed nav urls
  // (e.g. https://www.firm.com/who-we-are/...) still resolve to a page + get a
  // redirect. A raw startsWith('/') check would silently drop them, which left
  // nested pages 404ing after a nav edit.
  const seenMoves = new Set<string>()
  const validMoves = (Array.isArray(moves) ? moves : []).flatMap((m): Move[] => {
    if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') return []
    const from = toPathname(m.from)
    const to = toPathname(m.to)
    if (!from || !to || from === to) return []
    const key = `${from}::${to}`
    if (seenMoves.has(key)) return []
    seenMoves.add(key)
    return [{ from, to }]
  })
  // A chain (A→B, B→C) must run B→C first so B is free when A→B relocates there.
  const orderedMoves = orderMoves(validMoves)

  try {
    await ensureDraftBranch(ctx.githubRepo)

    // Resolve the page behind each move. Moves whose source page doesn't exist
    // are nav-only edits — skipped. Kept in orderedMoves order so a vacated slot
    // is freed before the move that reuses it.
    const planned: Array<Move & { fromPath: string; toPath: string; sha: string }> = []
    for (const m of orderedMoves) {
      const fromPath = pagePath(m.from)
      const toPath = pagePath(m.to)
      if (!fromPath || !toPath) continue
      let src
      try {
        src = await readFile(ctx.githubRepo, fromPath, DRAFT_BRANCH)
      } catch (err) {
        if (err instanceof FileNotFoundError) continue
        throw err
      }
      planned.push({ ...m, fromPath, toPath, sha: src.sha })
    }

    // Slots this batch will free — a target sitting in `vacated` isn't a real
    // collision (another move relocates that page first).
    const vacated = new Set(planned.map((p) => p.fromPath))

    // Confirm each destination is free, treating batch-vacated slots and the
    // page's own already-relocated file as non-collisions. A foreign page at the
    // target is a genuine conflict → 422 (client keeps edits and can rename).
    const toRelocate: typeof planned = []
    for (const p of planned) {
      let occupant
      try {
        occupant = await readFile(ctx.githubRepo, p.toPath, DRAFT_BRANCH)
      } catch (err) {
        if (err instanceof FileNotFoundError) {
          toRelocate.push(p)
          continue
        }
        throw err
      }
      if (vacated.has(p.toPath)) {
        toRelocate.push(p)
        continue
      }
      const occUrl = frontmatterUrl(occupant.content)
      if (occUrl && toPathname(occUrl) === p.to) continue // same page, already there
      return NextResponse.json(
        { error: `A page already exists at ${p.to}`, collision: { from: p.from, to: p.to } },
        { status: 422 }
      )
    }

    // Relocate each page (atomic, reuses the blob), then fix its canonical.
    for (const p of toRelocate) {
      await moveFile(
        ctx.githubRepo,
        p.fromPath,
        p.toPath,
        DRAFT_BRANCH,
        p.sha,
        `Move ${p.from} → ${p.to} via admin${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
        author(ctx)
      )
      const moved = await readFile(ctx.githubRepo, p.toPath, DRAFT_BRANCH)
      const fixed = swapFrontmatterUrl(moved.content, p.from, p.to)
      if (fixed !== moved.content) {
        await writeFile(ctx.githubRepo, p.toPath, fixed, DRAFT_BRANCH, `Update canonical for ${p.to}`, {
          expectedSha: moved.sha,
          ...author(ctx),
        })
      }
    }

    if (toRelocate.length > 0) {
      await appendRedirects(ctx, toRelocate.map((p) => ({ from: p.from, to: p.to })), 'Nested via nav editor')
    }

    const result = await writeFile(
      ctx.githubRepo,
      NAV_PATH,
      contents,
      DRAFT_BRANCH,
      `Edit nav.json via admin${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
      { expectedSha, ...author(ctx) }
    )

    return NextResponse.json({
      commitSha: result.commitSha,
      blobSha: result.blobSha,
      moved: toRelocate.length,
    })
  } catch (err) {
    if (err instanceof AssetExistsError) {
      return NextResponse.json({ error: 'A page already exists at the destination.' }, { status: 422 })
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
