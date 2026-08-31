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
  // Distinct error messages across failed selections, so the UI can show WHY
  // (e.g. "API usage limit reached") instead of a bare "N failed".
  errorSamples: string[]
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
    .select('status, error')
    .eq('content_job_id', contentJobId)
  const rows = data ?? []
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const pending = count('pending')
  const drafting = count('drafting')
  const errorSamples = [
    ...new Set(
      rows
        .filter((r) => r.status === 'error' && r.error)
        .map((r) => (r.error as string).slice(0, 160))
    ),
  ]
  return {
    total: rows.length,
    pending,
    drafting,
    complete: count('complete'),
    error: count('error'),
    errorSamples,
    terminal: pending + drafting === 0,
  }
}

// Reset every errored selection for a job back to 'pending' so a subsequent
// runLibrarySelectionsForJob retries it. Needed because an all-terminal job
// (every row complete/error) is skipped by /library/run's terminal guard and the
// cron — so a genuinely-failed article (API limit, timeout, unparseable output)
// has no other path back into drafting. Returns how many rows were reset.
export async function resetFailedLibrarySelections(contentJobId: string): Promise<number> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('content_job_library_selections')
    .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
    .eq('content_job_id', contentJobId)
    .eq('status', 'error')
    .select('id')
  return data?.length ?? 0
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

// Settle a selection from its idea's real draft_status — reconciles a row left
// 'drafting' (by a prior run, or a concurrent 'skipped' lock) once the underlying
// draft has actually finished. Leaves it 'drafting' if the idea hasn't settled
// yet; a re-run reconciles again. Shared by the in-flight pre-pass and the
// per-selection 'skipped' branch so the terminal-status mapping lives in one place.
async function settleFromIdeaStatus(
  supabase: ServerClient,
  selectionId: string,
  ideaId: string
): Promise<void> {
  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('draft_status, draft_error')
    .eq('id', ideaId)
    .single()
  if (idea?.draft_status === 'complete') await mark(supabase, selectionId, 'complete', null)
  else if (idea?.draft_status === 'error')
    await mark(supabase, selectionId, 'error', idea.draft_error ?? 'Generation failed')
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

  // insertBatchTargets already builds the session→idea-id map when it inserts the
  // per-client idea row; read it back directly instead of a follow-up SELECT.
  const { error, ideaBySession } = await insertBatchTargets(
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
  return ideaBySession.get(sessionId) ?? null
}

// Draft every not-yet-complete library selection for a content job, committing
// each as a UNIQUE article against this client's MBP to the repo draft branch.
// Called at Deliverables (phase 6), when the repo exists. Idempotent: a re-run
// reconciles in-flight rows and retries errored ones, so it can resume after a
// function timeout. Never throws — every selection settles to a terminal status.
export async function runLibrarySelectionsForJob(contentJobId: string): Promise<void> {
  const supabase = createServerClient()

  // Reconcile any row left 'drafting' by a prior run against the idea's real
  // draft_status, so a completed/failed draft closes out on resume. One batched
  // read for all in-flight ideas (not a query per row).
  const { data: inFlight } = await supabase
    .from('content_job_library_selections')
    .select('id, resource_idea_id')
    .eq('content_job_id', contentJobId)
    .eq('status', 'drafting')
  const inFlightRows = (inFlight ?? []).filter((r) => r.resource_idea_id)
  if (inFlightRows.length) {
    const { data: ideas } = await supabase
      .from('resource_ideas')
      .select('id, draft_status, draft_error')
      .in('id', inFlightRows.map((r) => r.resource_idea_id as string))
    const byId = new Map((ideas ?? []).map((i) => [i.id, i]))
    for (const row of inFlightRows) {
      const idea = byId.get(row.resource_idea_id as string)
      if (idea?.draft_status === 'complete') await mark(supabase, row.id, 'complete', null)
      else if (idea?.draft_status === 'error')
        await mark(supabase, row.id, 'error', idea.draft_error ?? 'Generation failed')
    }
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

  // The site repo isn't provisioned yet — a transient "too early" condition, not
  // a failure. Leave the selections PENDING (clearing any stale not-provisioned
  // error) so they read as "waiting" and auto-resume once the site is seeded: the
  // publish chain seeds the repo before its library step, and the cron re-runs
  // pending rows. Marking them 'error' made a timing issue look like a permanent
  // failure ("N failed") that only self-healed by chance.
  if (!isEligible) {
    await supabase
      .from('content_job_library_selections')
      .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
      .eq('content_job_id', contentJobId)
      .eq('status', 'error')
    return
  }

  for (const sel of selections) {
    try {
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
        // 'skipped' = another worker holds the idea lock; reconcile from
        // draft_status (or leave 'drafting' — a re-run reconciles).
        await settleFromIdeaStatus(supabase, sel.id, ideaId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await mark(supabase, sel.id, 'error', message.slice(0, 500))
    }
  }
}
