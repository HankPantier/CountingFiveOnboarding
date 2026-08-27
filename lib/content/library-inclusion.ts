import { createServerClient } from '@/lib/supabase/server'
import { generateResourceDraft } from './resource-draft-generator'
import { resolveEligibility, insertBatchTargets } from './blog-batch-targets'
import { asContentType } from './content-types'
import { asIndustry } from './industries'
import type { ExternalLink } from './link-checker'

type ServerClient = ReturnType<typeof createServerClient>

export interface LibrarySelectionStatus {
  total: number
  pending: number
  drafting: number
  complete: number
  error: number
  // True when nothing is left to wait on (all selections reached a terminal
  // state, or there were none). The publish gate reads this.
  terminal: boolean
}

// Snapshot of a content job's library-content selections, for the Deliverables
// completion gate + progress display.
export async function getLibrarySelectionStatus(
  contentJobId: string
): Promise<LibrarySelectionStatus> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('content_job_library_selections')
    .select('status')
    .eq('content_job_id', contentJobId)
  const rows = data ?? []
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const pending = count('pending')
  const drafting = count('drafting')
  return {
    total: rows.length,
    pending,
    drafting,
    complete: count('complete'),
    error: count('error'),
    terminal: pending + drafting === 0,
  }
}

async function mark(
  supabase: ServerClient,
  id: string,
  status: 'drafting' | 'complete' | 'error',
  error: string | null
): Promise<void> {
  await supabase
    .from('content_job_library_selections')
    .update({ status, error, updated_at: new Date().toISOString() })
    .eq('id', id)
}

// The verified external sources already attached to an earlier client's draft of
// this same batch idea, so a re-draft cites the same authoritative URLs. Empty on
// a batch whose only client is this fresh site.
async function siblingLinks(supabase: ServerClient, batchId: string): Promise<ExternalLink[]> {
  const { data: sib } = await supabase
    .from('blog_batch_targets')
    .select('resource_idea_id')
    .eq('batch_id', batchId)
    .not('resource_idea_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!sib?.resource_idea_id) return []
  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('external_links')
    .eq('id', sib.resource_idea_id)
    .single()
  const links = idea?.external_links
  return Array.isArray(links)
    ? links.filter((l): l is ExternalLink => !!l && typeof (l as ExternalLink).url === 'string')
    : []
}

// Ensure a per-client resource_ideas row exists for (batch, this session), reusing
// the batch fan-out so the draft is written against THIS client's MBP and tagged
// with the batch's content_type + industry. Returns the idea id (or null on failure).
async function ensureIdeaForSelection(
  supabase: ServerClient,
  batchId: string,
  sessionId: string,
  contentJobId: string
): Promise<string | null> {
  // Reuse an existing target's idea if this client is somehow already in the batch.
  const { data: existing } = await supabase
    .from('blog_batch_targets')
    .select('resource_idea_id')
    .eq('batch_id', batchId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (existing?.resource_idea_id) return existing.resource_idea_id

  const { data: batch } = await supabase
    .from('blog_batches')
    .select('title, angle, target_keyword, secondary_keywords, rationale, content_type, industry')
    .eq('id', batchId)
    .single()
  if (!batch) return null

  const secondaryKeywords = Array.isArray(batch.secondary_keywords)
    ? (batch.secondary_keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : []
  const verifiedLinks = await siblingLinks(supabase, batchId)

  const { error } = await insertBatchTargets(
    supabase,
    batchId,
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
    [{ sessionId, contentJobId }],
    []
  )
  if (error) return null

  const { data: created } = await supabase
    .from('blog_batch_targets')
    .select('resource_idea_id')
    .eq('batch_id', batchId)
    .eq('session_id', sessionId)
    .maybeSingle()
  return created?.resource_idea_id ?? null
}

// Draft every not-yet-complete library selection for a content job, committing
// each as a UNIQUE article against this client's MBP to the repo draft branch.
// Called at Deliverables (phase 6), when the repo exists. Idempotent: a re-run
// reconciles in-flight rows and retries errored ones, so it can resume after a
// function timeout. Never throws — every selection settles to a terminal status.
export async function runLibrarySelectionsForJob(contentJobId: string): Promise<void> {
  const supabase = createServerClient()

  // Reconcile any row left 'drafting' by a prior run against the idea's real
  // draft_status, so a completed/failed draft closes out on resume.
  const { data: inFlight } = await supabase
    .from('content_job_library_selections')
    .select('id, resource_idea_id')
    .eq('content_job_id', contentJobId)
    .eq('status', 'drafting')
  for (const row of inFlight ?? []) {
    if (!row.resource_idea_id) continue
    const { data: idea } = await supabase
      .from('resource_ideas')
      .select('draft_status, draft_error')
      .eq('id', row.resource_idea_id)
      .single()
    if (idea?.draft_status === 'complete') await mark(supabase, row.id, 'complete', null)
    else if (idea?.draft_status === 'error') await mark(supabase, row.id, 'error', idea.draft_error ?? 'Generation failed')
  }

  const { data: selections } = await supabase
    .from('content_job_library_selections')
    .select('id, session_id, batch_id, resource_idea_id')
    .eq('content_job_id', contentJobId)
    .in('status', ['pending', 'error'])
  if (!selections?.length) return

  const sessionId = selections[0].session_id
  const { eligible } = await resolveEligibility(supabase, [sessionId])
  const isEligible = eligible.some((e) => e.contentJobId === contentJobId)

  for (const sel of selections) {
    try {
      if (!isEligible) {
        await mark(supabase, sel.id, 'error', 'Site repo not provisioned yet — publish the site first, then retry.')
        continue
      }
      let ideaId = sel.resource_idea_id
      if (!ideaId) {
        ideaId = await ensureIdeaForSelection(supabase, sel.batch_id, sessionId, contentJobId)
        if (!ideaId) {
          await mark(supabase, sel.id, 'error', 'Could not create the per-client article')
          continue
        }
        await supabase
          .from('content_job_library_selections')
          .update({ resource_idea_id: ideaId, status: 'drafting', updated_at: new Date().toISOString() })
          .eq('id', sel.id)
      } else {
        await mark(supabase, sel.id, 'drafting', null)
      }

      const result = await generateResourceDraft(ideaId)
      if (result.status === 'complete') {
        await mark(supabase, sel.id, 'complete', null)
      } else if (result.status === 'error') {
        await mark(supabase, sel.id, 'error', result.error ?? 'Generation failed')
      } else {
        // 'skipped' = another worker holds the idea lock; reconcile from draft_status.
        const { data: idea } = await supabase
          .from('resource_ideas')
          .select('draft_status, draft_error')
          .eq('id', ideaId)
          .single()
        if (idea?.draft_status === 'complete') await mark(supabase, sel.id, 'complete', null)
        else if (idea?.draft_status === 'error') await mark(supabase, sel.id, 'error', idea.draft_error ?? 'Generation failed')
        // else leave 'drafting' — the other worker will finish it; a re-run reconciles.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await mark(supabase, sel.id, 'error', message.slice(0, 500))
    }
  }
}
