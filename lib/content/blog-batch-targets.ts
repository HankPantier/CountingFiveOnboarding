import type { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import type { ExternalLink } from '@/lib/content/link-checker'

type ServerClient = ReturnType<typeof createServerClient>

export interface BatchIdeaFields {
  title: string
  angle: string | null
  targetKeyword: string | null
  secondaryKeywords: string[]
  rationale: string | null
}

export interface BatchClient {
  sessionId: string
  contentJobId: string
}

export interface Eligibility {
  eligible: BatchClient[]
  ineligible: BatchClient[]
}

// Eligibility for a drafted batch post = the client has a content_job with a
// provisioned github_repo and phase >= 6 (the precondition the editor's drafting
// pipeline enforces). Clients with no content job at all are dropped entirely —
// there's nothing to attach a draft to.
export async function resolveEligibility(
  supabase: ServerClient,
  sessionIds: string[]
): Promise<Eligibility> {
  const { data: jobs } = await supabase
    .from('content_jobs')
    .select('id, session_id, github_repo, phase')
    .in('session_id', sessionIds)

  const jobBySession = new Map((jobs ?? []).map((j) => [j.session_id, j]))
  const eligible: BatchClient[] = []
  const ineligible: BatchClient[] = []
  for (const sessionId of sessionIds) {
    const job = jobBySession.get(sessionId)
    if (!job) continue
    if (job.github_repo && job.phase >= 6) {
      eligible.push({ sessionId, contentJobId: job.id })
    } else {
      ineligible.push({ sessionId, contentJobId: job.id })
    }
  }
  return { eligible, ineligible }
}

// Create one real per-client idea row per eligible client (the existing pipeline
// drafts these against each client's MBP) plus the batch_target rows that the
// runner processes. Shared by batch creation and add-clients.
export async function insertBatchTargets(
  supabase: ServerClient,
  batchId: string,
  idea: BatchIdeaFields,
  verifiedLinks: ExternalLink[],
  eligible: BatchClient[],
  ineligible: BatchClient[]
): Promise<{ error: string | null }> {
  let ideaBySession = new Map<string, string>()

  if (eligible.length) {
    const { data: ideas, error: ideasErr } = await supabase
      .from('resource_ideas')
      .insert(
        eligible.map((e) => ({
          content_job_id: e.contentJobId,
          session_id: e.sessionId,
          title: idea.title,
          angle: idea.angle,
          target_keyword: idea.targetKeyword,
          secondary_keywords: asJson(idea.secondaryKeywords),
          rationale: idea.rationale,
          external_links: asJson(verifiedLinks),
          status: 'approved',
          draft_status: 'idle',
        }))
      )
      .select('id, session_id')

    if (ideasErr || !ideas) {
      console.error('[blog-batch] Failed to create per-client ideas:', ideasErr?.message)
      return { error: 'Failed to create per-client ideas' }
    }
    ideaBySession = new Map(ideas.map((i) => [i.session_id, i.id]))
  }

  const targetRows = [
    ...eligible.map((e) => ({
      batch_id: batchId,
      session_id: e.sessionId,
      content_job_id: e.contentJobId,
      resource_idea_id: ideaBySession.get(e.sessionId) ?? null,
      status: 'pending',
    })),
    ...ineligible.map((e) => ({
      batch_id: batchId,
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
    return { error: 'Failed to create batch targets' }
  }

  return { error: null }
}
