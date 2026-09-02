import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { discoverImportableArticles } from '@/lib/content/article-import-discovery'

export const runtime = 'nodejs'

const MAX_IMPORTS = 30

// GET — the client's own existing articles (discovered in the audit crawl) that
// can be brought into the new site AS-IS, plus which are already selected.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireContentJobAccess(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()
  const discovery = await discoverImportableArticles(id)

  const { data: selections } = await supabase
    .from('content_job_article_imports')
    .select('source_url')
    .eq('content_job_id', id)
  const selectedUrls = (selections ?? []).map((s) => s.source_url)

  return NextResponse.json({
    auditRunId: discovery.auditRunId,
    articles: discovery.articles,
    syndicationAssessment: discovery.syndicationAssessment,
    selectedUrls,
  })
}

interface SaveBody {
  urls?: string[]
}

// POST — record which existing articles to import verbatim (idempotent replace).
// The actual import is deferred to Deliverables (phase 6), when the repo exists.
// Only 'pending' selections are reconciled here — once an import has started
// drafting it is immutable to a late phase-4 edit. Stamps articles_reviewed_at
// so the phase 4 → 5 advance is gated on an explicit review (even "select none").
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireContentJobAccess(id)
  if (ctx instanceof NextResponse) return ctx

  let body: SaveBody
  try {
    body = (await req.json()) as SaveBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Validate every requested URL against the discovered allow-list — never trust
  // an arbitrary client-supplied URL (it becomes a server-side fetch target).
  const discovery = await discoverImportableArticles(id)
  const allowed = new Map(discovery.articles.map((a) => [a.url, a.title]))
  const rawUrls = Array.isArray(body.urls) ? body.urls : []
  const urls = [...new Set(rawUrls.filter((u) => typeof u === 'string' && allowed.has(u)))]
  if (urls.length > MAX_IMPORTS) {
    return NextResponse.json({ error: `Select ${MAX_IMPORTS} articles or fewer` }, { status: 400 })
  }

  const supabase = createServerClient()

  // Clear all still-pending selections, then re-insert the kept set. Rows that
  // already advanced (drafting/complete/error) are untouched by the status
  // filter, and the upsert's ignoreDuplicates leaves them as-is. Avoids the
  // fragile PostgREST `not in (...)` filter on URL strings (commas/slashes).
  const { error: delErr } = await supabase
    .from('content_job_article_imports')
    .delete()
    .eq('content_job_id', id)
    .eq('status', 'pending')
  if (delErr) {
    console.error('[imports] Failed to prune selections:', delErr.message)
    return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 })
  }

  if (urls.length) {
    if (!discovery.auditRunId) {
      return NextResponse.json({ error: 'No audit is available for this session' }, { status: 400 })
    }
    const { error: upErr } = await supabase.from('content_job_article_imports').upsert(
      urls.map((url) => ({
        content_job_id: id,
        session_id: ctx.sessionId,
        audit_run_id: discovery.auditRunId as string,
        source_url: url,
        source_title: allowed.get(url) ?? null,
        status: 'pending',
      })),
      { onConflict: 'content_job_id,source_url', ignoreDuplicates: true }
    )
    if (upErr) {
      console.error('[imports] Failed to upsert selections:', upErr.message)
      return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 })
    }
  }

  const { error: reviewErr } = await supabase
    .from('content_jobs')
    .update({ articles_reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (reviewErr) {
    console.error('[imports] Failed to stamp review:', reviewErr.message)
    return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 })
  }

  return NextResponse.json({ saved: urls.length })
}
