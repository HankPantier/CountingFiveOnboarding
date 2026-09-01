import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { getStatus, walkCommitFileStats } from '@/lib/github/repo-files'
import {
  aggregateEditStats,
  type EditStatsAggregate,
  type EditStatRow,
  type EditStatsResponse,
} from '@/lib/content/edit-stats'
import { contentPathToUrl } from '@/lib/editor/content-paths'
import { estimateCostUsd } from '@/lib/content/token-pricing'
import { asJson } from '@/lib/supabase/json-typed'

export const runtime = 'nodejs'
// First view of a repo walks its commit history (one getCommit per commit), so
// allow generous time; subsequent views hit the head-sha cache and are instant.
export const maxDuration = 300

// AI-edit token spend is recorded per page under these stages, keyed by the
// content file path in page_url.
const PAGE_EDIT_STAGES = ['content_edit', 'seo_fields', 'content_assistant']

// GET — admin-only per-page edit activity: how many times each page/resource was
// edited (AI vs manual), the churn (lines +/−), AI token spend + $, and who last
// edited it. Derived from the draft branch's git history, cached by draft HEAD.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  // Edit activity is an operator/billing-style view — admins only (managers,
  // editors, and site owners who can otherwise use the editor don't see it).
  if (!ctx.user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServerClient()

  try {
    const headSha = (await getStatus(ctx.githubRepo)).lastCommitSha

    const { data: cached } = await supabase
      .from('content_edit_stats')
      .select('head_sha, stats')
      .eq('session_id', ctx.sessionId)
      .maybeSingle()

    let aggregate: EditStatsAggregate
    let truncated = false
    if (cached && headSha && cached.head_sha === headSha) {
      // jsonb round-trips as the aggregate we wrote via asJson().
      aggregate = cached.stats as unknown as EditStatsAggregate
    } else {
      const walk = await walkCommitFileStats(ctx.githubRepo)
      aggregate = aggregateEditStats(walk.commits)
      truncated = walk.truncated
      await supabase.from('content_edit_stats').upsert({
        session_id: ctx.sessionId,
        head_sha: walk.headSha ?? headSha ?? '',
        stats: asJson(aggregate),
        computed_at: new Date().toISOString(),
      })
    }

    // Enrich with AI-edit token spend, keyed by content path (= token_usage.page_url).
    const { data: tokenRows } = await supabase
      .from('token_usage')
      .select('page_url, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens')
      .eq('session_id', ctx.sessionId)
      .in('stage', PAGE_EDIT_STAGES)
      .not('page_url', 'is', null)
      .range(0, 49999)

    const spend = new Map<string, { tokens: number; cost: number }>()
    for (const r of tokenRows ?? []) {
      const path = r.page_url as string
      const entry = spend.get(path) ?? { tokens: 0, cost: 0 }
      entry.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
      entry.cost += estimateCostUsd(
        r.model,
        r.input_tokens ?? 0,
        r.output_tokens ?? 0,
        r.cache_read_input_tokens ?? 0,
        r.cache_creation_input_tokens ?? 0
      )
      spend.set(path, entry)
    }

    const rows: EditStatRow[] = Object.values(aggregate)
      .map((r) => {
        const s = spend.get(r.path)
        return {
          ...r,
          url: contentPathToUrl(r.path),
          aiTokens: s?.tokens ?? 0,
          aiCostUsd: s?.cost ?? 0,
        }
      })
      .sort((a, b) => b.editCount - a.editCount)

    return NextResponse.json({ rows, truncated } satisfies EditStatsResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
