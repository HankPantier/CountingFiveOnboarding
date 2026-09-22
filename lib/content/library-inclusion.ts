import { createServerClient } from '@/lib/supabase/server'
import { generateResourceDraft } from './resource-draft-generator'
import { createBudget, runWithPool } from './generation-budget'
import { resumeEndpointFor } from './resume-targets'

// Must match the maxDuration on /api/content-jobs/[id]/library/{run,retry}.
const LIBRARY_ROUTE_MAX_DURATION_MS = 600_000
// One selection = a resource draft (up to 2 model calls) plus an inline social
// generation plus an MBP impact review. Don't start one without room to finish.
const LIBRARY_MIN_VIABLE_MS = 180_000
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
    .select('id, status, error, resource_idea_id')
    .eq('content_job_id', contentJobId)
  const selections = data ?? []

  // Derive each row's EFFECTIVE status from the idea that owns the draft, not
  // from the selection row alone.
  //
  // The selection table is denormalized state, and nothing guarantees it is
  // fresh: reconciliation only happens inside runLibrarySelectionsForJob, and the
  // sweep deliberately won't start a run while anything is still 'drafting'. So a
  // row could sit at 'pending' for an hour next to an article that had been
  // written and committed weeks earlier, and this gate — which is what blocks
  // publish — had no way to know. Reading through to the idea means the gate
  // cannot be wrong even if no runner has executed.
  const ideaIds = selections.map((r) => r.resource_idea_id).filter((x): x is string => !!x)
  const ideaById = new Map<string, { draft_status: string | null; draft_error: string | null }>()
  if (ideaIds.length) {
    const { data: ideas } = await supabase
      .from('resource_ideas')
      .select('id, draft_status, draft_error')
      .in('id', ideaIds)
    for (const i of ideas ?? []) ideaById.set(i.id, i)
  }

  const rows = selections.map((r) => {
    const idea = r.resource_idea_id ? ideaById.get(r.resource_idea_id) : undefined
    const settled = settleSelectionFromIdea(r.status, idea?.draft_status, idea?.draft_error)
    return {
      id: r.id,
      status: settled?.status ?? r.status,
      error: settled?.status === 'error' ? (settled.error ?? r.error) : r.error,
      stale: !!settled && settled.status !== r.status,
    }
  })

  // Converge the stored rows in the background so the staleness doesn't persist.
  // Best-effort: a failure here must never fail the status read or the publish.
  const stale = rows.filter((r) => r.stale)
  if (stale.length) {
    void Promise.all(
      stale.map((r) =>
        supabase
          .from('content_job_library_selections')
          .update({ status: r.status, error: r.error, updated_at: new Date().toISOString() })
          .eq('id', r.id)
      )
    ).catch((err) => console.warn('[library-status] self-heal write failed:', err))
  }

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

// How a selection row should settle given its own status and its idea's real
// draft_status. Pure so the rule is testable without a database.
//
//  - Idea complete  -> the article exists and is committed. The selection is done,
//    whatever its own row says. This is the case that used to hang publish.
//  - Idea errored   -> only settles a 'drafting' row (which would otherwise block
//    forever). A 'pending'/'error' row is LEFT ALONE so the runner re-drafts it —
//    that is exactly what a retry is for.
//  - Anything else (idea still pending/running/missing) -> leave it be.
export function settleSelectionFromIdea(
  selectionStatus: string,
  ideaStatus: string | null | undefined,
  ideaError?: string | null
): { status: 'complete' | 'error'; error?: string } | null {
  if (selectionStatus === 'complete') return null
  if (ideaStatus === 'complete') return { status: 'complete' }
  if (ideaStatus === 'error' && selectionStatus === 'drafting') {
    return { status: 'error', error: ideaError ?? 'Generation failed' }
  }
  return null
}

// Draft every not-yet-complete library selection for a content job, committing
// each as a UNIQUE article against this client's MBP to the repo draft branch.
// Called at Deliverables (phase 6), when the repo exists. Idempotent: a re-run
// reconciles in-flight rows and retries errored ones, so it can resume after a
// function timeout. Never throws — every selection settles to a terminal status.
export async function runLibrarySelectionsForJob(contentJobId: string): Promise<void> {
  const supabase = createServerClient()

  // Reconcile every NOT-YET-COMPLETE row against its idea's real draft_status.
  //
  // This used to cover only rows left 'drafting'. But a selection can just as
  // easily sit at 'pending' or 'error' while its idea has already drafted and
  // been committed — a worker that died after finishing the idea but before
  // marking the selection, or a cron retry that reset a stale error back to
  // pending. Those rows then never settled: the publish gate
  // (terminal = pending + drafting === 0) stayed blocked forever on articles that
  // were already written, and the runner re-drafted finished work to "fix" it.
  //
  // The idea is the source of truth — it owns the draft and its repo path.
  const { data: openRows } = await supabase
    .from('content_job_library_selections')
    .select('id, status, resource_idea_id')
    .eq('content_job_id', contentJobId)
    .in('status', ['pending', 'drafting', 'error'])
  const withIdea = (openRows ?? []).filter((r) => r.resource_idea_id)
  if (withIdea.length) {
    const { data: ideas } = await supabase
      .from('resource_ideas')
      .select('id, draft_status, draft_error')
      .in('id', withIdea.map((r) => r.resource_idea_id as string))
    const byId = new Map((ideas ?? []).map((i) => [i.id, i]))
    for (const row of withIdea) {
      const idea = byId.get(row.resource_idea_id as string)
      const settled = settleSelectionFromIdea(row.status, idea?.draft_status, idea?.draft_error)
      if (settled) await mark(supabase, row.id, settled.status, settled.error ?? null)
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

  // Budgeted, resumable, and still STRICTLY SEQUENTIAL: every item commits to the
  // same repo draft branch, so concurrent workers race each other's git writes.
  // A pool of 1 buys the thing that was actually missing — a deadline check
  // BEFORE each item. Previously this loop walked every selection with no notion
  // of elapsed time inside a 600s function, while each item is 1-2 Sonnet calls
  // at 24k/32k output plus an inline social call plus an MBP impact review. A
  // dozen items could never fit, so the function was killed and the in-flight row
  // was left claimed as 'drafting' until a sweep noticed.
  const budget = createBudget({ maxDurationMs: LIBRARY_ROUTE_MAX_DURATION_MS })

  const { skipped } = await runWithPool(
    selections,
    1,
    budget,
    async (sel) => {
      try {
        let ideaId = sel.resource_idea_id
        if (!ideaId) {
          ideaId = await ensureIdeaForSelection(supabase, sel.batch_id, sessionId, contentJobId)
          if (!ideaId) {
            await mark(supabase, sel.id, 'error', 'Could not create the per-client article')
            return
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
    },
    LIBRARY_MIN_VIABLE_MS
  )

  // Chain a fresh invocation for whatever didn't fit. This pipeline had no chain
  // at all — it relied entirely on the 5-minute cron noticing. Pick the endpoint
  // from the job's ACTUAL remaining state rather than assuming /run: leftovers can
  // include rows still marked `error`, and /run short-circuits on a job with no
  // pending or drafting rows, which would silently drop them (the same trap the
  // cron fell into).
  if (skipped.length) {
    const remaining = await getLibrarySelectionStatus(contentJobId)
    const endpoint = resumeEndpointFor({
      pending: remaining.pending,
      drafting: remaining.drafting,
      error: remaining.error,
    })
    console.warn(
      `[library-run] Budget reached with ${skipped.length} selection(s) left (elapsed ${budget.elapsed()}ms) — chaining via ${endpoint ?? 'none'}.`
    )
    if (endpoint) await chainLibraryRun(contentJobId, endpoint)
  }
}

// Self-chain over HTTP so the continuation gets a fresh function lifetime, the
// same mechanism the page pipeline uses.
async function chainLibraryRun(contentJobId: string, endpoint: 'run' | 'retry'): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  const cronSecret = process.env.CRON_SECRET
  if (!baseUrl || !cronSecret) {
    console.warn('[library-run] Chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.')
    return
  }
  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
  try {
    await fetch(`${url}/api/content-jobs/${contentJobId}/library/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
  } catch (err) {
    console.error('[library-run] Chain failed:', err)
  }
}
