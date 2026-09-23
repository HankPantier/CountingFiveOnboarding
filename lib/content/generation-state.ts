// Pure helpers for reasoning about a content job's generated_pages state.
//
// generated_pages rows are seeded for EVERY confirmed-sitemap page at sitemap
// confirm (phase 2→3) — long before outlines are approved. The runner only ever
// generates pages whose outline is admin_approved, so a `pending` row for an
// unapproved outline is never going to move. Counting it as outstanding work
// made shouldChainGeneration re-chain forever (pending > 0, completed = 0) and
// kept the job from ever finalizing. Every completion/chain decision therefore
// runs over the approved subset only.

// Callers pass content-generator's MAX_GENERATION_ATTEMPTS explicitly (kept as a
// parameter so this module has no import cycle with the generator).
export type PageStateRow = {
  page_url: string
  generation_status: string
  generation_attempts?: number | null
}

export type GenerationSummary = {
  completeCount: number
  errorCount: number
  pendingCount: number
  runningCount: number
  retriableErrorCount: number
  /** Every in-scope page is `complete` or a capped-out `error`. False when nothing is in scope. */
  allDone: boolean
  /** Number of pages considered (the approved subset). */
  total: number
}

/**
 * Restrict `pages` to the ones whose outline is approved. When `approvedUrls`
 * is null the filter is skipped (callers that don't know the outline state).
 */
export function scopeToApproved<T extends { page_url: string }>(
  pages: T[],
  approvedUrls: ReadonlySet<string> | null
): T[] {
  if (!approvedUrls) return pages
  return pages.filter(p => approvedUrls.has(p.page_url))
}

export function summarizeGenerationState(
  pages: PageStateRow[],
  approvedUrls: ReadonlySet<string> | null,
  maxAttempts: number
): GenerationSummary {
  const scoped = scopeToApproved(pages, approvedUrls)
  let completeCount = 0
  let errorCount = 0
  let pendingCount = 0
  let runningCount = 0
  let retriableErrorCount = 0
  for (const p of scoped) {
    if (p.generation_status === 'complete') completeCount++
    else if (p.generation_status === 'pending') pendingCount++
    else if (p.generation_status === 'running') runningCount++
    else if (p.generation_status === 'error') {
      errorCount++
      if ((p.generation_attempts ?? 0) < maxAttempts) retriableErrorCount++
    }
  }
  const terminal = completeCount + (errorCount - retriableErrorCount)
  return {
    completeCount,
    errorCount,
    pendingCount,
    runningCount,
    retriableErrorCount,
    allDone: scoped.length > 0 && terminal === scoped.length,
    total: scoped.length,
  }
}

/**
 * Pages that would be silently missing from a package: anything still
 * `running`, plus `pending` pages whose outline is approved (work the runner
 * will still do). A `pending` row for an unapproved outline is never going to
 * be generated, so it is not "in flight" and doesn't block packaging.
 */
export function selectUnfinishedPages<T extends { page_url: string; generation_status: string | null }>(
  pages: T[],
  approvedUrls: ReadonlySet<string>
): T[] {
  return pages.filter(
    p =>
      p.generation_status === 'running' ||
      (p.generation_status === 'pending' && approvedUrls.has(p.page_url))
  )
}
