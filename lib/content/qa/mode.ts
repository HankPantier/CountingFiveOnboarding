// QA Desk rollout switch. shadow = run + report only (legacy critic unchanged,
// phase 6 doesn't wait); on = apply patches, replace the critic, gate phase 6.
export type QaMode = 'off' | 'shadow' | 'on'

export const QA_MAX_ATTEMPTS = 2

export function qaMode(env: Record<string, string | undefined> = process.env): QaMode {
  const v = env.CONTENT_QA_MODE?.trim().toLowerCase()
  return v === 'off' || v === 'on' ? v : 'shadow'
}

// True while any COMPLETE page still has QA queued/running — or a retriable
// QA error (attempts below the cap, which the sweep will re-fire) — and the mode
// gates on it. Only 'on' holds the phase 5→6 advance and the content-ready email;
// treating a retriable error as terminal would let a late retry patch a page a
// human is already proofing.
export function qaOutstanding(
  pages: Array<{ generation_status: string; qa_status: string | null; qa_attempts?: number | null }>,
  mode: QaMode,
): boolean {
  if (mode !== 'on') return false
  return pages.some(
    p =>
      p.generation_status === 'complete' &&
      (p.qa_status === 'queued' ||
        p.qa_status === 'running' ||
        (p.qa_status === 'error' && (p.qa_attempts ?? 0) < QA_MAX_ATTEMPTS)),
  )
}
