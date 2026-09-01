import { after, NextResponse } from 'next/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext, type EditContext } from '../_helpers'
import { normalizeSlug } from './_slug'
import { createServerClient } from '@/lib/supabase/server'
import { buildStarterPage, generateNewPage } from '@/lib/content/new-page-generator'
import { appendNavItem } from '@/lib/editor/nav-mutations'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  ensureDraftBranch,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
// The AI first-draft runs in an after() callback (outline + page generation +
// Pexels image fetch/push) — give it the same headroom as the one-off route so
// generation isn't truncated by the function timeout.
export const maxDuration = 300

const MAX_TITLE = 120
const MAX_BRIEF = 500

interface CreatePageBody {
  title?: string
  slug?: string
  addToNav?: boolean
  mode?: 'blank' | 'ai'
  brief?: string
}

const author = (ctx: EditContext) => ({
  authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name,
  authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let body: CreatePageBody
  try {
    body = (await req.json()) as CreatePageBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const mode = body.mode === 'ai' ? 'ai' : 'blank'
  const brief = typeof body.brief === 'string' ? body.brief.trim() : ''
  const addToNav = body.addToNav === true
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (title.length > MAX_TITLE) {
    return NextResponse.json({ error: `Title must be ${MAX_TITLE} characters or fewer` }, { status: 400 })
  }
  if (brief.length > MAX_BRIEF) {
    return NextResponse.json({ error: `Brief must be ${MAX_BRIEF} characters or fewer` }, { status: 400 })
  }

  const slugInput = typeof body.slug === 'string' && body.slug.trim() ? body.slug : title
  const normalized = normalizeSlug(slugInput)
  if (!normalized) {
    return NextResponse.json({ error: 'Enter a valid page slug (letters, numbers, and hyphens)' }, { status: 400 })
  }
  const { url, path } = normalized

  const supabase = createServerClient()

  try {
    await ensureDraftBranch(ctx.githubRepo)

    // Collision check — a page already living at this slug must not be
    // silently overwritten.
    try {
      await readFile(ctx.githubRepo, path, DRAFT_BRANCH)
      return NextResponse.json({ error: 'A page already exists at that URL' }, { status: 409 })
    } catch (err) {
      if (!(err instanceof FileNotFoundError)) throw err
    }

    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', ctx.sessionId)
      .single()
    const schema = (session?.schema_data ?? {}) as SessionSchema
    const firmName = schema.business?.name ?? 'the firm'

    // Write a valid starter file first so the page (and any nav link) exists
    // immediately and never dangles.
    const starter = await writeFile(
      ctx.githubRepo,
      path,
      buildStarterPage(title, url, firmName),
      DRAFT_BRANCH,
      `Create page ${url} via admin (${ctx.adminEmail ?? 'unknown'})`,
      author(ctx)
    )

    if (addToNav) await appendNavItem(ctx, title, url)

    let generationId: string | undefined
    if (mode === 'ai') {
      const { data: row, error } = await supabase
        .from('new_page_generations')
        .insert({
          content_job_id: ctx.jobId,
          session_id: ctx.sessionId,
          target_path: path,
          page_url: url,
          title,
          brief: brief || null,
          starter_sha: starter.blobSha,
          status: 'pending',
        })
        .select('id')
        .single()
      if (error || !row) {
        // The page exists; only the AI draft couldn't be scheduled.
        return NextResponse.json(
          { path, url, generationError: error?.message ?? 'Failed to schedule AI draft' },
          { status: 200 }
        )
      }
      generationId = row.id
      after(async () => {
        try {
          await generateNewPage(row.id)
        } catch (err) {
          console.error('[create-page] AI draft trigger failed:', err)
        }
      })
    }

    return NextResponse.json({ path, url, generationId })
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json({ error: 'This page changed on the server. Reload to continue.' }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
