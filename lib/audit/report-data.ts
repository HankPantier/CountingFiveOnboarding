// Shared data loaders for the audit report, used by the admin page, the public
// share page, and the HTML export. No React, no DOM.
import type { createServerClient } from '@/lib/supabase/server'
import type { CategoryScoreMap } from '@/types/audit-result'

type ServerClient = ReturnType<typeof createServerClient>

export interface PreviousRunDeltas {
  overall_score: number | null
  category_scores: CategoryScoreMap | null
}

/** Most-recent completed run of the same domain BY THE SAME OWNER, older than
 * `run` — drives the score-delta panel. Scoping to `created_by` keeps the
 * comparison meaningful and prevents one auditor's (or the public share page's)
 * delta from leaking another owner's scores for a shared domain. Returns null
 * when there is no prior run (incl. orphaned audits whose creator was deleted). */
export async function getPreviousRunDeltas(
  supabase: ServerClient,
  run: { domain: string; created_at: string; created_by: string | null },
): Promise<PreviousRunDeltas | null> {
  if (!run.created_by) return null
  const { data: prev } = await supabase
    .from('audit_runs')
    .select('overall_score, category_scores')
    .eq('domain', run.domain)
    .eq('created_by', run.created_by)
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
