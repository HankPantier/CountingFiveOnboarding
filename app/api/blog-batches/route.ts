import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import { runBlogBatch } from '@/lib/content/blog-batch-runner'
import { headCheckUrls, type ExternalLink } from '@/lib/content/link-checker'
import { asJson } from '@/lib/supabase/json-typed'
import type { RefinedBlogIdea } from '@/lib/content/blog-idea-refiner'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CLIENTS = 50

interface CreateBody {
  idea?: RefinedBlogIdea
  sessionIds?: string[]
  seed?: string
}

// Create a blog batch and fan one locked idea out to the selected clients.
// Eligibility = the client has a content_job with a provisioned github_repo and
// phase >= 6 (the same precondition the editor's drafting pipeline enforces).
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Content creation is a manager power — an auditor-only member has no
  // session access and must not be able to spend generation budget.
  if (!hasCapability(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const idea = body.idea
  if (!idea || typeof idea.title !== 'string' || !idea.title.trim()) {
    return NextResponse.json({ error: 'A locked idea with a title is required' }, { status: 400 })
  }

  const rawIds = Array.isArray(body.sessionIds) ? body.sessionIds : []
  const sessionIds = [...new Set(rawIds.filter((id) => typeof id === 'string' && UUID_RE.test(id)))]
  if (sessionIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one client' }, { status: 400 })
  }
  if (sessionIds.length > MAX_CLIENTS) {
    return NextResponse.json({ error: `Select ${MAX_CLIENTS} clients or fewer` }, { status: 400 })
  }

  // Scope: a manager may only target clients assigned to them.
  const allowed = await getAccessibleSessionIds(user)
  if (allowed !== null) {
    const allowedSet = new Set(allowed)
    if (sessionIds.some((id) => !allowedSet.has(id))) {
      return NextResponse.json({ error: 'Forbidden: one or more clients are not assigned to you' }, { status: 403 })
    }
  }

  const supabase = createServerClient()

  // Resolve each client's content job. Eligible = repo provisioned + phase >= 6.
  const { data: jobs } = await supabase
    .from('content_jobs')
    .select('id, session_id, github_repo, phase')
    .in('session_id', sessionIds)

  const jobBySession = new Map((jobs ?? []).map((j) => [j.session_id, j]))
  const eligible: Array<{ sessionId: string; contentJobId: string }> = []
  const ineligible: Array<{ sessionId: string; contentJobId: string }> = []
  for (const sessionId of sessionIds) {
    const job = jobBySession.get(sessionId)
    if (!job) continue // No content job at all — nothing to attach a draft to.
    if (job.github_repo && job.phase >= 6) {
      eligible.push({ sessionId, contentJobId: job.id })
    } else {
      ineligible.push({ sessionId, contentJobId: job.id })
    }
  }

  if (eligible.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected clients have a published, repo-linked site to draft into' },
      { status: 400 }
    )
  }

  const title = idea.title.trim()
  const angle = typeof idea.angle === 'string' && idea.angle.trim() ? idea.angle.trim() : null
  const targetKeyword =
    typeof idea.target_keyword === 'string' && idea.target_keyword.trim() ? idea.target_keyword.trim() : null
  const secondaryKeywords = Array.isArray(idea.secondary_keywords)
    ? idea.secondary_keywords.filter((k): k is string => typeof k === 'string')
    : []
  const rationale = typeof idea.rationale === 'string' && idea.rationale.trim() ? idea.rationale.trim() : null
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim().slice(0, 300) : null

  // Verify the AI-suggested sources once (shared across all clients) so the
  // per-client drafting prompt only ever sees live, authoritative URLs.
  const candidateLinks: ExternalLink[] = Array.isArray(idea.suggested_external_links)
    ? idea.suggested_external_links
        .filter((l): l is ExternalLink => !!l && typeof l.url === 'string')
        .slice(0, 3)
    : []
  const verifiedLinks = candidateLinks.length ? await headCheckUrls(candidateLinks) : []

  const { data: batch, error: batchErr } = await supabase
    .from('blog_batches')
    .insert({
      title,
      angle,
      target_keyword: targetKeyword,
      secondary_keywords: asJson(secondaryKeywords),
      rationale,
      seed,
      created_by: user.id,
      status: 'generating',
    })
    .select('id')
    .single()

  if (batchErr || !batch) {
    console.error('[blog-batch] Failed to create batch:', batchErr?.message)
    return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  }

  // One real per-client idea row per eligible client — the existing pipeline
  // drafts these against each client's MBP.
  const { data: ideas, error: ideasErr } = await supabase
    .from('resource_ideas')
    .insert(
      eligible.map((e) => ({
        content_job_id: e.contentJobId,
        session_id: e.sessionId,
        title,
        angle,
        target_keyword: targetKeyword,
        secondary_keywords: asJson(secondaryKeywords),
        rationale,
        external_links: asJson(verifiedLinks),
        status: 'approved',
        draft_status: 'idle',
      }))
    )
    .select('id, session_id')

  if (ideasErr || !ideas) {
    console.error('[blog-batch] Failed to create per-client ideas:', ideasErr?.message)
    return NextResponse.json({ error: 'Failed to create per-client ideas' }, { status: 500 })
  }

  const ideaBySession = new Map(ideas.map((i) => [i.session_id, i.id]))

  const targetRows = [
    ...eligible.map((e) => ({
      batch_id: batch.id,
      session_id: e.sessionId,
      content_job_id: e.contentJobId,
      resource_idea_id: ideaBySession.get(e.sessionId) ?? null,
      status: 'pending',
    })),
    ...ineligible.map((e) => ({
      batch_id: batch.id,
      session_id: e.sessionId,
      content_job_id: e.contentJobId,
      resource_idea_id: null,
      status: 'skipped',
      error: 'Site is not published / repo not provisioned',
    })),
  ]

  const { error: targetsErr } = await supabase.from('blog_batch_targets').insert(targetRows)
  if (targetsErr) {
    console.error('[blog-batch] Failed to create targets:', targetsErr.message)
    return NextResponse.json({ error: 'Failed to create batch targets' }, { status: 500 })
  }

  after(async () => {
    try {
      await runBlogBatch(batch.id)
    } catch (err) {
      console.error('[blog-batch] Trigger failed:', err)
    }
  })

  return NextResponse.json({
    batchId: batch.id,
    created: eligible.length,
    skipped: ineligible.length,
  })
}
