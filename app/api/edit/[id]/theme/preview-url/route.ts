import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { getCurrentUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'
import type { PreviewUrlInfo } from '../_theme'

export const runtime = 'nodejs'

// Accept only a well-formed http(s) URL with no credentials. The shell route's
// safeGet re-checks SSRF at fetch time; this is the syntactic gate at save.
function normalizePreviewUrl(raw: unknown): string | null | { error: string } {
  if (raw === null) return null
  if (typeof raw !== 'string') return { error: 'previewUrl must be a string or null.' }
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.length > 300) return { error: 'That URL is too long.' }
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return { error: 'Enter a full URL, e.g. https://acme.vercel.app' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'URL must start with http:// or https://' }
  if (u.username || u.password) return { error: 'URL must not contain credentials.' }
  return u.toString()
}

async function gate(id: string) {
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const user = await getCurrentUser()
  if (!user || !user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return ctx
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await gate(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('preview_url')
    .eq('id', ctx.jobId)
    .single()

  const previewUrl = job?.preview_url ?? null
  const configUrl = await readSiteConfigSiteUrl(ctx.githubRepo, MAIN_BRANCH)
  const info: PreviewUrlInfo = { previewUrl, configUrl, effectiveUrl: previewUrl ?? configUrl }
  return NextResponse.json(info)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await gate(id)
  if (ctx instanceof NextResponse) return ctx

  let body: { previewUrl?: unknown }
  try {
    body = (await req.json()) as { previewUrl?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const next = normalizePreviewUrl(body.previewUrl)
  if (next !== null && typeof next === 'object') {
    return NextResponse.json({ error: next.error }, { status: 400 })
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('content_jobs')
    .update({ preview_url: next, updated_at: new Date().toISOString() })
    .eq('id', ctx.jobId)
  if (error) {
    return NextResponse.json({ error: 'Failed to save the preview URL.' }, { status: 500 })
  }

  const configUrl = await readSiteConfigSiteUrl(ctx.githubRepo, MAIN_BRANCH)
  const info: PreviewUrlInfo = { previewUrl: next, configUrl, effectiveUrl: next ?? configUrl }
  return NextResponse.json(info)
}
