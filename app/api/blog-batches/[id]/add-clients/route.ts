import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import { runBlogBatch } from '@/lib/content/blog-batch-runner'
import { resolveEligibility, insertBatchTargets } from '@/lib/content/blog-batch-targets'
import { asContentType } from '@/lib/content/content-types'
import { asIndustry } from '@/lib/content/industries'
import type { ExternalLink } from '@/lib/content/link-checker'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CLIENTS = 50

interface AddBody {
  sessionIds?: string[]
}

// POST /api/blog-batches/[id]/add-clients — fan this batch's locked idea out to
// additional clients and run just for them. Mirrors the create route's auth and
// eligibility, dedupes against clients already in the batch, and reuses the same
// verified external links so added drafts cite the same sources.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasCapability(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  let body: AddBody
  try {
    body = (await req.json()) as AddBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const rawIds = Array.isArray(body.sessionIds) ? body.sessionIds : []
  const requestedIds = [...new Set(rawIds.filter((v) => typeof v === 'string' && UUID_RE.test(v)))]
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one client' }, { status: 400 })
  }
  if (requestedIds.length > MAX_CLIENTS) {
    return NextResponse.json({ error: `Select ${MAX_CLIENTS} clients or fewer` }, { status: 400 })
  }

  // Scope: a manager may only target clients assigned to them.
  const allowed = await getAccessibleSessionIds(user)
  if (allowed !== null) {
    const allowedSet = new Set(allowed)
    if (requestedIds.some((sid) => !allowedSet.has(sid))) {
      return NextResponse.json({ error: 'Forbidden: one or more clients are not assigned to you' }, { status: 403 })
    }
  }

  const supabase = createServerClient()

  const { data: batch } = await supabase
    .from('blog_batches')
    .select('id, title, angle, target_keyword, secondary_keywords, rationale, content_type, industry')
    .eq('id', id)
    .single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Drop clients already in this batch (respects the (batch_id, session_id) unique index).
  const { data: existing } = await supabase
    .from('blog_batch_targets')
    .select('session_id, resource_idea_id')
    .eq('batch_id', id)
  const existingSessionIds = new Set((existing ?? []).map((t) => t.session_id))
  const sessionIds = requestedIds.filter((sid) => !existingSessionIds.has(sid))
  if (sessionIds.length === 0) {
    return NextResponse.json({ error: 'All selected clients are already in this batch' }, { status: 400 })
  }

  const { eligible, ineligible } = await resolveEligibility(supabase, sessionIds)
  if (eligible.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected clients have a published, repo-linked site to draft into' },
      { status: 400 }
    )
  }

  // Reuse the sources already verified for this batch's earlier clients so the
  // added drafts cite the same authoritative URLs.
  let verifiedLinks: ExternalLink[] = []
  const siblingIdeaId = (existing ?? []).map((t) => t.resource_idea_id).find((v): v is string => !!v)
  if (siblingIdeaId) {
    const { data: sibling } = await supabase
      .from('resource_ideas')
      .select('external_links')
      .eq('id', siblingIdeaId)
      .single()
    const links = sibling?.external_links
    if (Array.isArray(links)) {
      verifiedLinks = links.filter((l): l is ExternalLink => !!l && typeof (l as ExternalLink).url === 'string')
    }
  }

  const secondaryKeywords = Array.isArray(batch.secondary_keywords)
    ? (batch.secondary_keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : []

  const { error: targetsError } = await insertBatchTargets(
    supabase,
    id,
    {
      title: batch.title,
      angle: batch.angle,
      targetKeyword: batch.target_keyword,
      secondaryKeywords,
      rationale: batch.rationale,
      contentType: asContentType(batch.content_type),
      industry: asIndustry(batch.industry),
    },
    verifiedLinks,
    eligible,
    ineligible
  )
  if (targetsError) {
    return NextResponse.json({ error: targetsError }, { status: 500 })
  }

  await supabase
    .from('blog_batches')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', id)

  after(async () => {
    try {
      await runBlogBatch(id)
    } catch (err) {
      console.error('[blog-batch] Add-clients trigger failed:', err)
    }
  })

  return NextResponse.json({ added: eligible.length, skipped: ineligible.length })
}
