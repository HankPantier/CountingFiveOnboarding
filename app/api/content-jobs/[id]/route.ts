import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'
import { runContentGeneration } from '@/lib/content/content-generator'
import { discoverImportableArticles } from '@/lib/content/article-import-discovery'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
// Routes that trigger content generation need a long maxDuration because the
// after() block runs the pipeline post-response. PATCHes that don't trigger
// generation complete in milliseconds and exit immediately — the longer cap
// only applies when there's pending work.
export const maxDuration = 300

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await readJsonBody<{
    palette?: unknown
    design_tokens?: unknown
    confirmed_sitemap?: unknown
    nav_config?: unknown
    phase?: number
    status?: string
    error_message?: unknown
  }>(req)
  if (body instanceof NextResponse) return body

  const supabase = createServerClient()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.palette !== undefined) updates.palette = body.palette
  if (body.design_tokens !== undefined) updates.design_tokens = body.design_tokens
  if (body.confirmed_sitemap !== undefined) updates.confirmed_sitemap = body.confirmed_sitemap
  if (body.nav_config !== undefined) updates.nav_config = body.nav_config
  if (body.phase !== undefined) {
    // Content-job phases run 1–6 (see PhaseStepper). Phase 5 auto-triggers
    // generation below, so reject out-of-range values rather than write them.
    if (!Number.isInteger(body.phase) || body.phase < 1 || body.phase > 6) {
      return NextResponse.json({ error: 'Invalid phase' }, { status: 400 })
    }
    updates.phase = body.phase
  }
  if (body.status !== undefined) {
    const validStatuses = ['active', 'complete', 'error']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }
  if (body.error_message !== undefined) updates.error_message = body.error_message

  // Completeness gates before content generation (phase 5 trigger).
  if (body.phase === 5) {
    const { data: job } = await supabase
      .from('content_jobs')
      .select('session_id, library_reviewed_at, articles_reviewed_at')
      .eq('id', id)
      .single()

    // The operator must make an explicit library-content inclusion choice (select
    // + save, or save none) at outline proofing. The OutlinePhase UI gates on
    // this; enforcing it here stops a direct PATCH from skipping the review.
    if (job && !job.library_reviewed_at) {
      return NextResponse.json(
        { error: 'Confirm your library-content choice on the outline step before starting content generation.' },
        { status: 422 },
      )
    }

    // Same gate for verbatim article imports — but only when the audit actually
    // surfaced importable articles. A session with no blog (or no audit) has an
    // empty panel and must never deadlock, so auto-stamp and proceed.
    if (job && !job.articles_reviewed_at) {
      const { articles } = await discoverImportableArticles(id)
      if (articles.length > 0) {
        return NextResponse.json(
          { error: 'Confirm your existing-article import choice on the outline step before starting content generation.' },
          { status: 422 },
        )
      }
      await supabase
        .from('content_jobs')
        .update({ articles_reviewed_at: new Date().toISOString() })
        .eq('id', id)
    }

    // Without a firm name the generator falls back to "the firm"/"Unknown firm"
    // everywhere, producing unusable content. Block the advance instead.
    if (job?.session_id) {
      const { data: sess } = await supabase.from('sessions').select('schema_data').eq('id', job.session_id).single()
      const name = (sess?.schema_data as SessionSchema | null)?.business?.name
      if (!name || !name.trim()) {
        return NextResponse.json(
          { error: 'Cannot start content generation: the MBP has no firm name. Add it on the MBP page first.' },
          { status: 422 },
        )
      }
    }
  }

  const { data, error } = await supabase
    .from('content_jobs')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-trigger content generation when advancing to phase 5.
  // after() guarantees the work runs within maxDuration on Vercel; plain
  // fire-and-forget gets terminated once the response leaves the function.
  if (body.phase === 5 && data.session_id) {
    const sessionId = data.session_id
    after(async () => {
      try {
        await runContentGeneration(id, sessionId)
      } catch (err) {
        console.error('[content-gen] Auto-trigger failed:', err)
      }
    })
  }

  return NextResponse.json({ contentJob: data })
}
