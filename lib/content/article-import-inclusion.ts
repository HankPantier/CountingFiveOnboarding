import { createServerClient } from '@/lib/supabase/server'
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

  for (const row of imports) {
    try {
      await importArticleAsIs(row.id)
    } catch (err) {
      // importArticleAsIs never throws, but guard the loop regardless so one bad
      // row can't abort the rest.
      console.error(`[article-import] Unexpected throw on ${row.id}:`, err)
    }
  }
}
