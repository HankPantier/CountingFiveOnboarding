import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'
import { classifyStoredPreviewUrl, resolvePreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { internalError } from '@/lib/api/errors'
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
  const user = ctx.user
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return ctx
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await gate(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    return NextResponse.json(await previewUrlInfo(ctx))
  } catch (err) {
    return internalError('theme-preview-url', err, 'Could not look up the preview URL.')
  }
}

// What the preview fetches (resolvePreviewSiteUrl: stored preview_url →
// verified Vercel address, cached into preview_url → site.config). A stored
// value equal to the derived Vercel address is reported as source 'vercel',
// not as an operator override, so the UI can tell them apart. That check
// reads only the in-memory lookup result (classifyStoredPreviewUrl) and never
// waits on GitHub.
async function previewUrlInfo(ctx: { jobId: string; githubRepo: string }): Promise<PreviewUrlInfo> {
  const args = { jobId: ctx.jobId, githubRepo: ctx.githubRepo }
  const [resolved, configUrl] = await Promise.all([resolvePreviewSiteUrl(args), readSiteConfigSiteUrl(ctx.githubRepo, MAIN_BRANCH)])
  let source: PreviewUrlInfo['source']
  if (resolved.source === 'config') source = 'siteUrl'
  else if (resolved.source === 'vercel') source = 'vercel'
  else source = resolved.url ? classifyStoredPreviewUrl(ctx.githubRepo, resolved.url) : 'override'
  const previewUrl = resolved.source === 'config' ? null : resolved.url
  return { previewUrl, source, configUrl, effectiveUrl: resolved.url }
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

  // Cleared → re-resolve the default (the verified Vercel address when there
  // is one). The value IS saved at this point, so a failed follow-up lookup
  // (DB/GitHub hiccup) still answers 200 with what was saved, not a 500.
  try {
    return NextResponse.json(await previewUrlInfo(ctx))
  } catch (err) {
    console.warn('[theme-preview-url] Saved the preview URL but could not re-resolve it:', err instanceof Error ? err.message : err)
    const saved: PreviewUrlInfo = { previewUrl: next, source: next ? 'override' : 'siteUrl', configUrl: null, effectiveUrl: next }
    return NextResponse.json(saved)
  }
}
