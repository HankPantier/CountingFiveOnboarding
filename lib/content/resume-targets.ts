// Which endpoint the stuck-job sweep should call to resume a per-item drafting
// pipeline (included library articles, verbatim article imports).
//
// The sweep used to always POST `/run`. But `/run` short-circuits when the job is
// `terminal`, and terminal means `pending + drafting === 0` — so a job whose items
// had ALL failed was terminal, `/run` returned `{started:false}` with HTTP 200,
// and the cron counted a success while doing nothing at all. Those rows could only
// ever be moved by a human clicking "Retry failed (N)", which is why that button
// was load-bearing rather than a convenience.
//
// `/retry` resets error → pending and then runs; it no-ops when nothing resets.
// So: retry when there is anything to reset, run when there is only fresh work,
// and stay out of the way while something is genuinely in flight.
export type ItemCounts = { pending: number; drafting: number; error: number }

export function resumeEndpointFor(counts: ItemCounts): 'run' | 'retry' | null {
  if (counts.drafting > 0) return null
  if (counts.error > 0) return 'retry'
  if (counts.pending > 0) return 'run'
  return null
}

// Group raw status rows into per-job counts, then pick each job's endpoint.
export function resumePlan(
  rows: Array<{ content_job_id: string; status: string }>,
  limit = 5
): Array<{ jobId: string; endpoint: 'run' | 'retry' }> {
  const counts = new Map<string, ItemCounts>()
  for (const r of rows) {
    const c = counts.get(r.content_job_id) ?? { pending: 0, drafting: 0, error: 0 }
    if (r.status === 'drafting') c.drafting += 1
    else if (r.status === 'error') c.error += 1
    else if (r.status === 'pending') c.pending += 1
    counts.set(r.content_job_id, c)
  }
  const plan: Array<{ jobId: string; endpoint: 'run' | 'retry' }> = []
  for (const [jobId, c] of counts) {
    const endpoint = resumeEndpointFor(c)
    if (endpoint) plan.push({ jobId, endpoint })
    if (plan.length >= limit) break
  }
  return plan
}
