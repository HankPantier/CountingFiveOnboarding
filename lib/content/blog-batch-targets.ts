import type { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import type { ExternalLink } from '@/lib/content/link-checker'
import { hasCaseStudyData, type ContentType } from '@/lib/content/content-types'
import type { Industry } from '@/lib/content/industries'
import { activeNiches } from '@/lib/content/active-niches'
import { objArr } from '@/lib/content/schema-coerce'
import type { SessionSchema } from '@/types/session-schema'

type ServerClient = ReturnType<typeof createServerClient>
type ServiceArea = NonNullable<NonNullable<SessionSchema['business']>['serviceAreas']>[number]

export interface BatchIdeaFields {
  title: string
  angle: string | null
  targetKeyword: string | null
  secondaryKeywords: string[]
  rationale: string | null
  contentType: ContentType
  industry: Industry
}

export interface BatchClient {
  sessionId: string
  contentJobId: string
  // Why an ineligible client was skipped (repo not provisioned, no case data, …).
  // Surfaced on the skipped batch_target row so the operator sees the real cause.
  ineligibleReason?: string
}

export interface Eligibility {
  eligible: BatchClient[]
  ineligible: BatchClient[]
}

const DEFAULT_INELIGIBLE_REASON = 'Site is not published / repo not provisioned'

// Eligibility for a drafted batch post = the client has a content_job with a
// provisioned github_repo and phase >= 6 (the precondition the editor's drafting
// pipeline enforces). Clients with no content job at all are dropped entirely —
// there's nothing to attach a draft to. When the batch is a case study,
// requireCaseData also drops clients with no client success story on file, up
// front — otherwise the draft only fails at generation time (hasCaseStudyData).
export async function resolveEligibility(
  supabase: ServerClient,
  sessionIds: string[],
  opts?: { requireCaseData?: boolean }
): Promise<Eligibility> {
  const { data: jobs } = await supabase
    .from('content_jobs')
    .select('id, session_id, github_repo, phase')
    .in('session_id', sessionIds)

  const jobBySession = new Map((jobs ?? []).map((j) => [j.session_id, j]))

  // Only load schemas when we actually need them (the case-study gate).
  let schemaBySession = new Map<string, SessionSchema>()
  if (opts?.requireCaseData) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, schema_data')
      .in('id', sessionIds)
    schemaBySession = new Map(
      (sessions ?? []).map((s) => [s.id, (s.schema_data ?? {}) as SessionSchema])
    )
  }

  const eligible: BatchClient[] = []
  const ineligible: BatchClient[] = []
  for (const sessionId of sessionIds) {
    const job = jobBySession.get(sessionId)
    if (!job) continue
    if (!(job.github_repo && job.phase >= 6)) {
      ineligible.push({ sessionId, contentJobId: job.id, ineligibleReason: DEFAULT_INELIGIBLE_REASON })
      continue
    }
    if (opts?.requireCaseData) {
      const schema = schemaBySession.get(sessionId) ?? ({} as SessionSchema)
      if (!hasCaseStudyData(schema, null)) {
        ineligible.push({
          sessionId,
          contentJobId: job.id,
          ineligibleReason: 'No client success story on file — a case study needs one',
        })
        continue
      }
    }
    eligible.push({ sessionId, contentJobId: job.id })
  }
  return { eligible, ineligible }
}

// Per-client tailoring of the shared batch idea. The draft prompt already threads
// each firm's brand voice + niche context, but the idea's angle and keywords were
// identical for every client — so the drafts read interchangeably. Here we point
// the angle at the firm's dominant niche + primary market and add one niche-
// qualified secondary keyword, deterministically (no model call). Pure + exported
// for tests.
export function individualizeIdea(
  idea: BatchIdeaFields,
  schema: SessionSchema | undefined
): { angle: string | null; secondaryKeywords: string[] } {
  if (!schema) return { angle: idea.angle, secondaryKeywords: idea.secondaryKeywords }

  // Dominant niche: prefer a strong audit signal, then moderate, else the first.
  const niches = activeNiches(schema).filter((n) => typeof n.name === 'string' && n.name.trim())
  const dominant =
    niches.find((n) => n.signal === 'strong') ??
    niches.find((n) => n.signal === 'moderate') ??
    niches[0]
  const nicheName = dominant?.name?.trim()

  const areas = objArr<ServiceArea>(schema.business?.serviceAreas)
  const market =
    areas.find((a) => a.primary)?.city?.trim() ||
    areas[0]?.city?.trim() ||
    schema.locations?.[0]?.city?.trim() ||
    ''
  const firmName = schema.business?.name?.trim() || 'this firm'

  if (!nicheName) return { angle: idea.angle, secondaryKeywords: idea.secondaryKeywords }

  const addendum = `Tailor this to ${firmName}'s audience — write for ${nicheName} clients${market ? ` in ${market}` : ''}, using concrete detail relevant to them rather than generic advice.`
  const angle = idea.angle ? `${idea.angle} ${addendum}` : addendum

  // Add a niche-qualified secondary keyword (kept as a SECONDARY so the shared
  // primary keyword — the vetted target — is never weakened). Skip if the primary
  // already names the niche, or the variant already exists.
  const secondaryKeywords = [...idea.secondaryKeywords]
  const primaryLc = (idea.targetKeyword ?? '').toLowerCase()
  const nicheLc = nicheName.toLowerCase()
  if (idea.targetKeyword && !primaryLc.includes(nicheLc)) {
    const variant = `${idea.targetKeyword} for ${nicheName}`
    if (!secondaryKeywords.some((k) => k.toLowerCase() === variant.toLowerCase())) {
      secondaryKeywords.push(variant)
    }
  }
  return { angle, secondaryKeywords }
}

// Create one real per-client idea row per eligible client (the existing pipeline
// drafts these against each client's MBP) plus the batch_target rows that the
// runner processes. Shared by batch creation and add-clients. Returns the
// session→idea-id map it already builds, so a single-client caller (library
// inclusion) can read the created idea id without a follow-up SELECT.
export async function insertBatchTargets(
  supabase: ServerClient,
  batchId: string,
  idea: BatchIdeaFields,
  verifiedLinks: ExternalLink[],
  eligible: BatchClient[],
  ineligible: BatchClient[]
): Promise<{ error: string | null; ideaBySession: Map<string, string> }> {
  let ideaBySession = new Map<string, string>()

  if (eligible.length) {
    // Load each eligible client's schema once so the shared idea can be tailored
    // to that firm's dominant niche + market (individualizeIdea).
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, schema_data')
      .in('id', eligible.map((e) => e.sessionId))
    const schemaBySession = new Map(
      (sessions ?? []).map((s) => [s.id, (s.schema_data ?? {}) as SessionSchema])
    )

    const { data: ideas, error: ideasErr } = await supabase
      .from('resource_ideas')
      .insert(
        eligible.map((e) => {
          const per = individualizeIdea(idea, schemaBySession.get(e.sessionId))
          return {
            content_job_id: e.contentJobId,
            session_id: e.sessionId,
            title: idea.title,
            angle: per.angle,
            target_keyword: idea.targetKeyword,
            secondary_keywords: asJson(per.secondaryKeywords),
            rationale: idea.rationale,
            external_links: asJson(verifiedLinks),
            status: 'approved',
            draft_status: 'idle',
            content_type: idea.contentType,
            industry: idea.industry,
          }
        })
      )
      .select('id, session_id')

    if (ideasErr || !ideas) {
      console.error('[blog-batch] Failed to create per-client ideas:', ideasErr?.message)
      return { error: 'Failed to create per-client ideas', ideaBySession }
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
      content_type: idea.contentType,
      industry: idea.industry,
    })),
    ...ineligible.map((e) => ({
      batch_id: batchId,
      session_id: e.sessionId,
      content_job_id: e.contentJobId,
      resource_idea_id: null,
      status: 'skipped',
      error: e.ineligibleReason ?? DEFAULT_INELIGIBLE_REASON,
      content_type: idea.contentType,
      industry: idea.industry,
    })),
  ]

  const { error: targetsErr } = await supabase.from('blog_batch_targets').insert(targetRows)
  if (targetsErr) {
    console.error('[blog-batch] Failed to create targets:', targetsErr.message)
    return { error: 'Failed to create batch targets', ideaBySession }
  }

  return { error: null, ideaBySession }
}
