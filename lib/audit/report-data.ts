// Shared data loaders for the audit report, used by the admin page, the public
// share page, and the HTML export. No React, no DOM.
import type { createServerClient } from '@/lib/supabase/server'
import type { CategoryScoreMap } from '@/types/audit-result'

type ServerClient = ReturnType<typeof createServerClient>

export interface PreviousRunDeltas {
  overall_score: number | null
  category_scores: CategoryScoreMap | null
}

/** Most-recent completed run for the same domain, older than `run` — drives the
 * score-delta panel. Returns null when there is no prior run. */
export async function getPreviousRunDeltas(
  supabase: ServerClient,
  run: { domain: string; created_at: string },
): Promise<PreviousRunDeltas | null> {
  const { data: prev } = await supabase
    .from('audit_runs')
    .select('overall_score, category_scores')
    .eq('domain', run.domain)
    .eq('audit_status', 'complete')
    .lt('created_at', run.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!prev) return null
  return {
    overall_score: prev.overall_score,
    category_scores: (prev.category_scores as CategoryScoreMap | null) ?? null,
  }
}
