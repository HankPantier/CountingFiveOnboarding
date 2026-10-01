import type { createServerClient } from '@/lib/supabase/server'

// QA statuses a human edit must pre-empt. 'error' is included because the sweep
// re-fires retriable errors and the worker's claim accepts them.
export const QA_FENCED_STATUSES = ['queued', 'running', 'error'] as const

export interface QaFenceScope {
  /** Scope the flip to this job (defence in depth on the page id). */
  contentJobId: string
  /** Public client-review route: only fence a page actually flagged for review. */
  needsClientReview?: boolean
}

// Call BEFORE a human content edit / approval write. Flipping 'running' →
// 'skipped' breaks the QA worker's final fence (qa_status = 'running'), so a QA
// write can never land on top of the human's text; queued/error rows are no
// longer claimable. Returns whether a QA run was pre-empted. Fail-soft: a fence
// read error is logged, never blocks the human's edit.
export async function fenceQaForHumanEdit(
  supabase: ReturnType<typeof createServerClient>,
  pageId: string,
  scope: QaFenceScope,
): Promise<boolean> {
  let q = supabase
    .from('generated_pages')
    .update({ qa_status: 'skipped' })
    .eq('id', pageId)
    .eq('content_job_id', scope.contentJobId)
  if (scope.needsClientReview) q = q.eq('needs_client_review', true)
  const { data, error } = await q.in('qa_status', [...QA_FENCED_STATUSES]).select('id')
  if (error) {
    console.error(`[qa] human-edit fence failed for page ${pageId}:`, error)
    return false
  }
  return (data?.length ?? 0) > 0
}
