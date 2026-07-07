import { NextResponse } from 'next/server'
import { resolveEditContext, type EditContext } from '../_helpers'
import { safePath } from '../_path'
import { parseNavJson } from '@/lib/editor/nav-config'
import { toPathname } from '@/lib/editor/nav-urls'
import {
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
const REDIRECTS_PATH = 'content/redirects.csv'

type Move = { from: string; to: string }
type Body = { contents?: string; moves?: Move[]; expectedSha?: string }

const author = (ctx: EditContext) => ({
  authorName: 'CountingFive Admin',
  authorEmail: ctx.adminEmail ?? 'admin@countingfive.com',
})

// Root-relative page url → repo path, traversal-checked. Null for non-page urls.
function pagePath(url: string): string | null {
  if (!url.startsWith('/')) return null
  const slug = url.replace(/^\/+|\/+$/g, '')
  if (!slug) return null
  return safePath('content/pages/' + slug.replace(/\//g, '--') + '.md')
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Swap the trailing `from` path with `to` in the page's `url:`/`canonical_url:`
// frontmatter lines, preserving any host prefix. Keeps the canonical correct
// after the page moves.
function swapFrontmatterUrl(content: string, from: string, to: string): string {
  return content.replace(
    new RegExp('^((?:url|canonical_url):.*?)' + escapeRe(from) + '\\s*$', 'gm'),
    `$1${to}`
  )
}

async function appendRedirects(
  ctx: EditContext,
  pairs: Move[]
): Promise<void> {
  let content = ''
  let sha: string | undefined
  try {
    const f = await readFile(ctx.githubRepo, REDIRECTS_PATH, DRAFT_BRANCH)
    content = f.content
    sha = f.sha
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
    content = 'old_url,new_url,status_code,reason\n'
  }
  if (!content.endsWith('\n')) content += '\n'
  const existing = new Set(content.split('\n').map((l) => l.split(',')[0]))
  let added = false
  for (const { from, to } of pairs) {
    if (existing.has(from)) continue
    content += `${from},${to},301,Nested via nav editor\n`
    added = true
  }
  if (added) {
    await writeFile(ctx.githubRepo, REDIRECTS_PATH, content, DRAFT_BRANCH, 'Add redirects via admin', {
      ...(sha ? { expectedSha: sha } : {}),
      ...author(ctx),
    })
  }
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
  const validMoves = (Array.isArray(moves) ? moves : []).flatMap((m): Move[] => {
    if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') return []
    const from = toPathname(m.from)
    const to = toPathname(m.to)
    if (!from || !to || from === to) return []
    return [{ from, to }]
  })

  try {
    await ensureDraftBranch(ctx.githubRepo)

    // Pre-validate: resolve the page for each move, confirm the target is free.
    // Moves whose source page doesn't exist are nav-only edits — skipped.
    const planned: Array<Move & { fromPath: string; toPath: string; sha: string }> = []
    for (const m of validMoves) {
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
      try {
        await readFile(ctx.githubRepo, toPath, DRAFT_BRANCH)
        return NextResponse.json({ error: `A page already exists at ${m.to}` }, { status: 422 })
      } catch (err) {
        if (!(err instanceof FileNotFoundError)) throw err
      }
      planned.push({ ...m, fromPath, toPath, sha: src.sha })
    }

    // Relocate each page (atomic, reuses the blob), then fix its canonical.
    for (const p of planned) {
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

    if (planned.length > 0) {
      await appendRedirects(ctx, planned.map((p) => ({ from: p.from, to: p.to })))
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
      moved: planned.length,
    })
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
