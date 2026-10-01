import type { QaReview } from '@/types/qa-review'
import { mergeFindings, type PageFields } from './merge'
import { agentScores, qaPasses } from './judge'

// Apply or dismiss ONE QA finding on a human's request. Pure — the route
// loads/saves the page; this just computes the next fields + review.
export function applyOneFinding(
  fields: PageFields,
  review: QaReview,
  findingId: string,
  action: 'apply' | 'dismiss',
  templateVersion?: string | null,
): { ok: true; fields: PageFields; review: QaReview } | { ok: false; error: string } {
  const finding = review.findings.find(f => f.id === findingId)
  if (!finding || finding.status !== 'open') return { ok: false, error: 'That finding is no longer open.' }

  let nextFields = fields
  let status: 'dismissed' | 'accepted' = 'dismissed'
  if (action === 'apply') {
    if (!finding.patch && !finding.variantFix) return { ok: false, error: 'This finding has no automatic fix — edit the page by hand.' }
    // Human-initiated, so verbatim protection is waived and the finding is
    // forced to `safety: 'auto'` so mergeFindings actually attempts it.
    const r = mergeFindings(fields, [{ ...finding, safety: 'auto' }], { apply: true, protectedTexts: [], templateVersion })
    if (r.findings[0].status !== 'applied') return { ok: false, error: 'The text this fix targets has changed — edit it by hand.' }
    nextFields = r.fields
    status = 'accepted'
  }
  const findings = review.findings.map(f => (f.id === findingId ? { ...f, status } : f))
  return {
    ok: true,
    fields: nextFields,
    review: {
      ...review,
      findings,
      scores: agentScores(findings),
      passed: qaPasses(review.judge, findings),
      // Optimistic-lock counter for the route's server-side CAS
      // (qa_apply_page_update) — bumped on every apply/dismiss.
      rev: (review.rev ?? 0) + 1,
    },
  }
}
