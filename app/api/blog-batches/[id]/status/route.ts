import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { summarizeCritic } from '@/lib/content/critic-review'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BlogBatchTargetStatus = 'pending' | 'generating' | 'complete' | 'error' | 'skipped'

export interface BlogBatchTargetView {
  sessionId: string
  firmName: string | null
  websiteUrl: string
  status: BlogBatchTargetStatus
  slug: string | null
  draftPath: string | null
  error: string | null
  // Advisory critic verdict: true when the draft completed but the critic flagged
  // it as weak (needs a human look before it's proofed/published).
  needsReview: boolean
}

export interface BlogBatchStatusResponse {
  id: string
  title: string
  targetKeyword: string | null
  status: string
  targets: BlogBatchTargetView[]
  counts: { total: number; complete: number; error: number; skipped: number; inFlight: number; flagged: number }
}

// Effective per-client state. The resource_ideas.draft_status is the live truth
// while a draft runs; the target row carries pending/skipped.
function effectiveStatus(
  targetStatus: string,
  draftStatus: string | null | undefined
): BlogBatchTargetStatus {
  if (targetStatus === 'skipped') return 'skipped'
  switch (draftStatus) {
    case 'complete':
      return 'complete'
    case 'error':
      return 'error'
    case 'running':
      return 'generating'
    case 'idle':
      return 'pending'
    default:
      return (['pending', 'generating', 'complete', 'error', 'skipped'] as const).includes(
        targetStatus as BlogBatchTargetStatus
      )
        ? (targetStatus as BlogBatchTargetStatus)
        : 'pending'
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  const supabase = createServerClient()

  const { data: batch } = await supabase
    .from('blog_batches')
    .select('id, title, target_keyword, status')
    .eq('id', id)
    .single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Managers see only their assigned clients within the batch — push the scope
  // into the query (matching the retry route) instead of post-filtering rows
  // fetched with the service-role client.
  const allowed = await getAccessibleSessionIds(user)
  let targetsQuery = supabase
    .from('blog_batch_targets')
    .select('session_id, status, error, resource_idea_id')
    .eq('batch_id', id)
    .order('created_at', { ascending: true })
  if (allowed !== null) {
    if (allowed.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    targetsQuery = targetsQuery.in('session_id', allowed)
  }
  const { data: targets } = await targetsQuery

  const rows = targets ?? []
  if (allowed !== null && rows.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ideaIds = rows.map((r) => r.resource_idea_id).filter((v): v is string => !!v)
  const { data: ideas } = ideaIds.length
    ? await supabase
        .from('resource_ideas')
        .select('id, draft_status, slug, draft_path, draft_error')
        .in('id', ideaIds)
    : { data: [] }
  const ideaById = new Map((ideas ?? []).map((i) => [i.id, i]))

  // Advisory critic verdicts, fetched separately + best-effort: the critic_review
  // column may not exist yet (pre-migration 071), so a failure here degrades to
  // "no flags" rather than breaking the whole status endpoint.
  const flaggedIdeaIds = new Set<string>()
  if (ideaIds.length) {
    const { data: criticRows, error: criticErr } = await supabase
      .from('resource_ideas')
      .select('id, critic_review')
      .in('id', ideaIds)
    if (!criticErr) {
      for (const c of criticRows ?? []) {
        if (summarizeCritic(c.critic_review)?.needsReview) flaggedIdeaIds.add(c.id)
      }
    }
  }

  const sessionIds = rows.map((r) => r.session_id)
  const { data: sessions } = sessionIds.length
    ? await supabase.from('sessions').select('id, website_url, schema_data').in('id', sessionIds)
    : { data: [] }
  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]))

  const targetViews: BlogBatchTargetView[] = rows.map((r) => {
    const idea = r.resource_idea_id ? ideaById.get(r.resource_idea_id) : null
    const session = sessionById.get(r.session_id)
    const firmName = ((session?.schema_data ?? {}) as SessionSchema).business?.name ?? null
    const status = effectiveStatus(r.status, idea?.draft_status)
    // Only a completed draft can be "flagged" — the critic runs after completion.
    const needsReview = status === 'complete' && !!r.resource_idea_id && flaggedIdeaIds.has(r.resource_idea_id)
    return {
      sessionId: r.session_id,
      firmName,
      websiteUrl: session?.website_url ?? '',
      status,
      slug: idea?.slug ?? null,
      draftPath: idea?.draft_path ?? null,
      error: status === 'error' ? idea?.draft_error ?? r.error ?? 'Generation failed' : r.error ?? null,
      needsReview,
    }
  })

  const counts = {
    total: targetViews.length,
    complete: targetViews.filter((t) => t.status === 'complete').length,
    error: targetViews.filter((t) => t.status === 'error').length,
    skipped: targetViews.filter((t) => t.status === 'skipped').length,
    inFlight: targetViews.filter((t) => t.status === 'pending' || t.status === 'generating').length,
    flagged: targetViews.filter((t) => t.needsReview).length,
  }

  const response: BlogBatchStatusResponse = {
    id: batch.id,
    title: batch.title,
    targetKeyword: batch.target_keyword,
    status: batch.status,
    targets: targetViews,
    counts,
  }
  return NextResponse.json(response)
}
