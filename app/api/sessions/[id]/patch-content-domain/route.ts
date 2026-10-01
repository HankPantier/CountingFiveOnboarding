import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'
import { asJson } from '@/lib/supabase/json-typed'
import { hostOf, rewriteHost } from '@/lib/session/domain-rewrite'
import { fenceQaForPages } from '@/lib/content/qa/fence'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only follow-up to a domain change: rewrite the old host to the new host
// in the latest content job's confirmed sitemap and its generated_pages (URLs +
// body/meta). DB-only — the operator must re-publish for changes to reach the
// live/draft repo. Explicitly opt-in from the rename dialog.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await readJsonBody<{ oldHost?: string }>(req)
  if (body instanceof NextResponse) return body
  const oldHost = hostOf(body.oldHost)
  if (!oldHost) return NextResponse.json({ error: 'oldHost required' }, { status: 400 })

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('website_url')
    .eq('id', id)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const newHost = hostOf(session.website_url)
  if (!newHost || newHost === oldHost) {
    return NextResponse.json({ error: 'Current domain matches the old host — nothing to patch.' }, { status: 400 })
  }

  const { data: job } = await supabase
    .from('content_jobs')
    .select('id, confirmed_sitemap')
    .eq('session_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!job) return NextResponse.json({ sitemapUpdated: 0, pagesUpdated: 0 })

  // Sitemap URLs
  let sitemapUpdated = 0
  const sitemap = Array.isArray(job.confirmed_sitemap) ? job.confirmed_sitemap : []
  if (sitemap.length) {
    const next = sitemap.map(entry => {
      if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
        const e = entry as Record<string, unknown> & { url: string }
        const rewritten = rewriteHost(e.url, oldHost, newHost)
        if (rewritten !== e.url) {
          sitemapUpdated++
          return { ...e, url: rewritten }
        }
      }
      return entry
    })
    if (sitemapUpdated > 0) {
      await supabase.from('content_jobs').update({ confirmed_sitemap: asJson(next) }).eq('id', job.id)
    }
  }

  // Generated page URLs + body/meta
  const { data: pages } = await supabase
    .from('generated_pages')
    .select('id, page_url, canonical_url, content_markdown, answer_block, hero_block, meta_title, meta_description')
    .eq('content_job_id', job.id)

  const fields: Array<'page_url' | 'canonical_url' | 'content_markdown' | 'answer_block' | 'hero_block' | 'meta_title' | 'meta_description'> = [
    'page_url', 'canonical_url', 'content_markdown', 'answer_block', 'hero_block', 'meta_title', 'meta_description',
  ]
  const patches: Array<{ id: string; patch: Record<string, string> }> = []
  for (const p of pages ?? []) {
    const patch: Record<string, string> = {}
    for (const f of fields) {
      const val = p[f]
      if (typeof val === 'string' && val) {
        const next = rewriteHost(val, oldHost, newHost)
        if (next !== val) patch[f] = next
      }
    }
    if (Object.keys(patch).length) patches.push({ id: p.id, patch })
  }

  // A human-initiated rewrite of body/meta: pre-empt any in-flight or pending
  // QA run on these pages first so a QA write can't land on top of it.
  await fenceQaForPages(supabase, patches.map(x => x.id), job.id)

  let pagesUpdated = 0
  for (const { id: pageId, patch } of patches) {
    await supabase.from('generated_pages').update(patch).eq('id', pageId)
    pagesUpdated++
  }

  return NextResponse.json({ sitemapUpdated, pagesUpdated })
}
