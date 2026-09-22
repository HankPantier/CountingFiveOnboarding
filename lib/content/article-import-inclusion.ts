import { createServerClient } from '@/lib/supabase/server'
import { createBudget, runWithPool } from './generation-budget'
import { resumeEndpointFor } from './resume-targets'

// Must match the maxDuration on /api/content-jobs/[id]/imports/{run,retry}.
const IMPORTS_ROUTE_MAX_DURATION_MS = 600_000
// One import = fetch + html->md conversion + image re-hosting + a Haiku link pass.
const IMPORTS_MIN_VIABLE_MS = 120_000
import { importArticleAsIs } from './article-import-generator'

export interface ArticleImportStatus {
  total: number
  pending: number
  drafting: number
  complete: number
  error: number
  // Distinct error messages across failed imports, so the UI can show WHY.
  errorSamples: string[]
  // True when nothing is left to wait on. The publish gate reads this.
  terminal: boolean
}

// Snapshot of a content job's verbatim article imports, for the Deliverables
// completion gate + progress display. Mirrors getLibrarySelectionStatus.
export async function getArticleImportStatus(contentJobId: string): Promise<ArticleImportStatus> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('content_job_article_imports')
    .select('status, error')
    .eq('content_job_id', contentJobId)
  const rows = data ?? []
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const pending = count('pending')
  const drafting = count('drafting')
  const errorSamples = [
    ...new Set(
      rows
        .filter((r) => r.status === 'error' && r.error)
        .map((r) => (r.error as string).slice(0, 160))
    ),
  ]
  return {
    total: rows.length,
    pending,
    drafting,
    complete: count('complete'),
    error: count('error'),
    errorSamples,
    terminal: pending + drafting === 0,
  }
}

// Reset every errored import back to 'pending' so a subsequent run retries it.
// Needed because an all-terminal job is skipped by the run route's guard + the
// cron, so a genuinely-failed import has no other path back into drafting.
export async function resetFailedArticleImports(contentJobId: string): Promise<number> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('content_job_article_imports')
    .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
    .eq('content_job_id', contentJobId)
    .eq('status', 'error')
    .select('id')
  return data?.length ?? 0
}

// Import every not-yet-complete verbatim article for a content job, committing
// each to the repo draft branch. Called at Deliverables (phase 6), when the repo
// exists. Idempotent: importArticleAsIs holds a per-row atomic lock and settles
// each row to a terminal status, so a re-run resumes safely after a timeout.
// Never throws.
export async function runArticleImportsForJob(contentJobId: string): Promise<void> {
  const supabase = createServerClient()

  const { data: imports } = await supabase
    .from('content_job_article_imports')
    .select('id')
    .eq('content_job_id', contentJobId)
    .in('status', ['pending', 'error'])
  if (!imports?.length) return

  // Budgeted and resumable, mirroring the library runner. Strictly sequential:
  // every import commits to the same repo draft branch, so concurrent workers
  // would race each other's git writes. The deadline check before each row is
  // what this previously lacked entirely — it walked every import with no notion
  // of elapsed time, so a long list outran the function and left the in-flight
  // row claimed as 'drafting' until a sweep noticed.
  const budget = createBudget({ maxDurationMs: IMPORTS_ROUTE_MAX_DURATION_MS })

  const { skipped } = await runWithPool(
    imports,
    1,
    budget,
    async (row) => {
      try {
        await importArticleAsIs(row.id)
      } catch (err) {
        // importArticleAsIs never throws, but guard the loop regardless so one bad
        // row can't abort the rest.
        console.error(`[article-import] Unexpected throw on ${row.id}:`, err)
      }
    },
    IMPORTS_MIN_VIABLE_MS
  )

  if (skipped.length) {
    const remaining = await getArticleImportStatus(contentJobId)
    const endpoint = resumeEndpointFor({
      pending: remaining.pending,
      drafting: remaining.drafting,
      error: remaining.error,
    })
    console.warn(
      `[article-import] Budget reached with ${skipped.length} import(s) left (elapsed ${budget.elapsed()}ms) — chaining via ${endpoint ?? 'none'}.`
    )
    if (endpoint) await chainImportsRun(contentJobId, endpoint)
  }
}

// Self-chain over HTTP so the continuation gets a fresh function lifetime.
async function chainImportsRun(contentJobId: string, endpoint: 'run' | 'retry'): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  const cronSecret = process.env.CRON_SECRET
  if (!baseUrl || !cronSecret) {
    console.warn('[article-import] Chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.')
    return
  }
  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
  try {
    await fetch(`${url}/api/content-jobs/${contentJobId}/imports/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
  } catch (err) {
    console.error('[article-import] Chain failed:', err)
  }
}
