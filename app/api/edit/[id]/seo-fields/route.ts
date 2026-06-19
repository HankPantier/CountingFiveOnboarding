import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { safePath } from '../_path'
import { getCurrentUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { generateSeoField, isSeoField, SEO_MODEL } from '@/lib/content/seo-field-generator'
import { splitFile } from '@/lib/editor/frontmatter'
import { splitTrailers } from '@/lib/editor/page-body'
import { DRAFT_BRANCH, ensureDraftBranch, readFile, FileNotFoundError } from '@/lib/github/repo-files'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

const EDITABLE = ['content/pages/', 'content/posts/']

type Body = { path?: string; field?: string }

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // AI generation is admin-only, mirroring the AI content editor (ContentChatModal).
  const user = await getCurrentUser()
  if (!user || !user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { path: rawPath, field }: Body = await req.json()
  const path = rawPath ? safePath(rawPath) : null
  if (!path || !EDITABLE.some((p) => path.startsWith(p))) {
    return NextResponse.json({ error: 'Open a page or post to generate fields' }, { status: 400 })
  }
  if (!isSeoField(field)) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  }

  const supabase = createServerClient()

  let fileContent: string
  try {
    await ensureDraftBranch(ctx.githubRepo)
    fileContent = (await readFile(ctx.githubRepo, path, DRAFT_BRANCH)).content
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    throw err
  }

  const parsed = splitFile(fileContent)
  const pageContent = splitTrailers(parsed.body).content
  const pageTitle = parsed.frontmatter?.fields['title'] ?? path.split('/').pop() ?? path
  const pageUrl = parsed.frontmatter?.fields['url'] ?? ''

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', ctx.sessionId)
    .single()
  const schema = (session?.schema_data ?? {}) as SessionSchema

  const { data: job } = await supabase
    .from('content_jobs')
    .select('confirmed_sitemap')
    .eq('id', ctx.jobId)
    .single()
  const sitemapUrls = ((job?.confirmed_sitemap as Array<{ url?: string }> | null) ?? [])
    .map((s) => s.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  try {
    const { result, inputTokens, outputTokens } = await generateSeoField({
      field,
      pageTitle,
      pageUrl,
      pageContent,
      schema,
      sitemapUrls,
    })

    await recordTokenUsage({
      task: 'content',
      sessionId: ctx.sessionId,
      contentJobId: ctx.jobId,
      stage: 'seo_fields',
      pageUrl: path,
      model: SEO_MODEL,
      inputTokens,
      outputTokens,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
