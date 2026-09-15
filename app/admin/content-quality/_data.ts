import { createServerClient } from '@/lib/supabase/server'
import {
  parseCritic,
  criticOverall,
  summarizeCritic,
  CRITIC_DIMENSIONS,
} from '@/lib/content/critic-review'
import type { SessionSchema } from '@/types/session-schema'

// Read-side aggregation for the content-quality dashboard. Reads the advisory
// critic verdicts written on generated_pages (site page bodies) and resource_ideas
// (blog/resource drafts) and turns them into the measurement loop the generation
// changes lacked: how much has been scored, what the flag rate is, and where each
// quality dimension sits on average. Pure aggregation — no writes.

export interface DimAvg {
  key: string
  label: string
  avg: number // 0-10, one decimal
  n: number // how many reviews carried this dimension (extended dims are absent on legacy rows)
}

export interface QualitySlice {
  label: string
  scored: number
  flagged: number
  avgOverall: number // 0-10, one decimal
}

export interface FlaggedItem {
  kind: 'Page' | 'Blog'
  site: string | null // which client site this page/post belongs to (firm name, else host)
  label: string
  overall: number
  href: string | null
  scoredAt: string | null
}

export interface ContentQualityData {
  totalScored: number
  totalFlagged: number
  flaggedPct: number // 0-100, one decimal
  avgOverall: number // 0-10, one decimal
  dims: DimAvg[]
  slices: QualitySlice[] // [Pages, Blog & resources]
  recentFlagged: FlaggedItem[]
}

const round1 = (v: number): number => Math.round(v * 10) / 10

type Accumulator = {
  scored: number
  flagged: number
  overallSum: number
  dimSum: Record<string, number>
  dimN: Record<string, number>
}

function newAcc(): Accumulator {
  return { scored: 0, flagged: 0, overallSum: 0, dimSum: {}, dimN: {} }
}

// Fold one stored critic_review into an accumulator; returns the parsed overall +
// flagged so the caller can also build the recent-flagged list. Returns null when
// the row's review is missing/garbled (nothing to count).
function fold(acc: Accumulator, raw: unknown): { overall: number; flagged: boolean } | null {
  const parsed = parseCritic(raw)
  if (!parsed) return null
  acc.scored += 1
  const overall = criticOverall(parsed)
  acc.overallSum += overall
  for (const { key } of CRITIC_DIMENSIONS) {
    const v = (parsed as Record<string, unknown>)[key]
    if (typeof v === 'number') {
      acc.dimSum[key] = (acc.dimSum[key] ?? 0) + v
      acc.dimN[key] = (acc.dimN[key] ?? 0) + 1
    }
  }
  const flagged = summarizeCritic(raw)?.needsReview ?? false
  if (flagged) acc.flagged += 1
  return { overall, flagged }
}

function scoredAtOf(raw: unknown): string | null {
  return raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).scored_at === 'string'
    ? ((raw as Record<string, unknown>).scored_at as string)
    : null
}

export async function loadContentQuality(): Promise<ContentQualityData> {
  const supabase = createServerClient()

  const [pagesRes, resourcesRes] = await Promise.all([
    supabase
      .from('generated_pages')
      .select('critic_review, page_url, content_job_id')
      .not('critic_review', 'is', null),
    supabase
      .from('resource_ideas')
      .select('critic_review, title, session_id, draft_path')
      .not('critic_review', 'is', null),
  ])
  const pageRows = pagesRes.data ?? []
  // resource_ideas.critic_review is post-migration 071; degrade to empty on error.
  const resourceRows = resourcesRes.error ? [] : resourcesRes.data ?? []

  // Map page content_job_id → session_id so a flagged page can link to its editor.
  const jobIds = [...new Set(pageRows.map((r) => r.content_job_id).filter(Boolean))]
  const sessionByJob = new Map<string, string>()
  if (jobIds.length) {
    const { data: jobs } = await supabase.from('content_jobs').select('id, session_id').in('id', jobIds)
    for (const j of jobs ?? []) sessionByJob.set(j.id, j.session_id)
  }

  const pageAcc = newAcc()
  const resourceAcc = newAcc()
  // Interim flagged rows carry the session id + draft path so the site name and
  // href can be resolved after sort+slice (only for the ones we actually show).
  type FlaggedRaw = {
    kind: 'Page' | 'Blog'
    label: string
    overall: number
    scoredAt: string | null
    sessionId: string | null
    draftPath: string | null
  }
  const flaggedRaw: FlaggedRaw[] = []

  for (const r of pageRows) {
    const res = fold(pageAcc, r.critic_review)
    if (res?.flagged) {
      flaggedRaw.push({
        kind: 'Page',
        label: r.page_url ?? '(page)',
        overall: res.overall,
        scoredAt: scoredAtOf(r.critic_review),
        sessionId: sessionByJob.get(r.content_job_id) ?? null,
        draftPath: null,
      })
    }
  }
  for (const r of resourceRows) {
    const res = fold(resourceAcc, r.critic_review)
    if (res?.flagged) {
      flaggedRaw.push({
        kind: 'Blog',
        label: r.title ?? '(post)',
        overall: res.overall,
        scoredAt: scoredAtOf(r.critic_review),
        sessionId: r.session_id ?? null,
        draftPath: r.draft_path ?? null,
      })
    }
  }

  // Newest flagged first; undated (legacy) rows sink to the bottom. Slice to the
  // display set BEFORE resolving site names so we only load the sessions we show.
  flaggedRaw.sort((a, b) => (b.scoredAt ?? '').localeCompare(a.scoredAt ?? ''))
  const topFlagged = flaggedRaw.slice(0, 20)

  const siteBySession = new Map<string, string>()
  const flaggedSessionIds = [...new Set(topFlagged.map((f) => f.sessionId).filter((v): v is string => !!v))]
  if (flaggedSessionIds.length) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, website_url, schema_data')
      .in('id', flaggedSessionIds)
    for (const s of sessions ?? []) {
      const name = ((s.schema_data ?? {}) as SessionSchema).business?.name?.trim()
      const host = s.website_url ? s.website_url.replace(/^https?:\/\//, '').replace(/\/+$/, '') : ''
      siteBySession.set(s.id, name || host || '(unknown site)')
    }
  }

  const recentFlagged: FlaggedItem[] = topFlagged.map((f) => ({
    kind: f.kind,
    site: f.sessionId ? siteBySession.get(f.sessionId) ?? null : null,
    label: f.label,
    overall: f.overall,
    href: f.sessionId
      ? `/admin/content/${f.sessionId}/edit${f.kind === 'Blog' && f.draftPath ? `?path=${encodeURIComponent(f.draftPath)}` : ''}`
      : null,
    scoredAt: f.scoredAt,
  }))

  const totalScored = pageAcc.scored + resourceAcc.scored
  const totalFlagged = pageAcc.flagged + resourceAcc.flagged
  const overallSum = pageAcc.overallSum + resourceAcc.overallSum

  const dims: DimAvg[] = CRITIC_DIMENSIONS.map(({ key, label }) => {
    const n = (pageAcc.dimN[key] ?? 0) + (resourceAcc.dimN[key] ?? 0)
    const sum = (pageAcc.dimSum[key] ?? 0) + (resourceAcc.dimSum[key] ?? 0)
    return { key, label, n, avg: n ? round1(sum / n) : 0 }
  })

  const slice = (label: string, acc: Accumulator): QualitySlice => ({
    label,
    scored: acc.scored,
    flagged: acc.flagged,
    avgOverall: acc.scored ? round1(acc.overallSum / acc.scored) : 0,
  })

  return {
    totalScored,
    totalFlagged,
    flaggedPct: totalScored ? round1((totalFlagged / totalScored) * 100) : 0,
    avgOverall: totalScored ? round1(overallSum / totalScored) : 0,
    dims,
    slices: [slice('Site pages', pageAcc), slice('Blog & resources', resourceAcc)],
    recentFlagged,
  }
}
