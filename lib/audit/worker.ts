// Bridge between the run route and the pure engine. Loads the audit_runs row,
// runs runAudit() with an onProgress that throttles status writes, persists the
// result, and records terminal state. The atomic running-state guard lives in
// the run route; this worker owns all other persistence.
import { asJson } from '@/lib/supabase/json-typed'
import { createServerClient } from '@/lib/supabase/server'
import { runAudit } from './index'
import type { AuditResult, AuditStage } from './types'

const PROGRESS_WRITE_INTERVAL_MS = 1500

/** Persisted result drops per-page HTML + response headers — they are large and
 * not needed to re-score (scoring consumes `analyzed`, not raw HTML). */
function trimForStorage(result: AuditResult): AuditResult {
  if (!result.raw) return result
  return {
    ...result,
    raw: {
      ...result.raw,
      pages: result.raw.pages.map((p) => ({ ...p, html: '', response_headers: {} })),
    },
  }
}

export async function runAuditJob(auditRunId: string): Promise<void> {
  const supabase = createServerClient()

  // The atomic guard in the /run route already set this row to a running state
  // before after() dispatched us, so any early return MUST write a terminal
  // state — otherwise the row stays "crawling" until the 15-min cron sweep.
  const writeError = async (message: string) => {
    await supabase
      .from('audit_runs')
      .update({
        audit_status: 'error',
        status_detail: 'Audit failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', auditRunId)
  }

  let row: { url: string; site_name: string | null; max_pages: number; focus_segments: string[] | null } | null
  try {
    const { data } = await supabase
      .from('audit_runs')
      .select('url, site_name, max_pages, focus_segments')
      .eq('id', auditRunId)
      .single()
    row = data
  } catch (err) {
    console.error('[audit-worker] failed to load run:', err)
    await writeError('Could not load audit run').catch(() => {})
    return
  }

  if (!row) {
    console.error('[audit-worker] run not found:', auditRunId)
    await writeError('Run was deleted before the worker started').catch(() => {})
    return
  }

  let lastWrite = 0
  let lastStage = ''
  let terminated = false // once the terminal write lands, suppress late progress writes

  const onProgress = async (stage: AuditStage, detail: string, pagesCrawled?: number) => {
    if (terminated) return
    const now = Date.now()
    if (stage === lastStage && now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return
    lastStage = stage
    lastWrite = now
    const update: { audit_status: string; status_detail: string; pages_crawled?: number } = {
      audit_status: stage,
      status_detail: detail,
    }
    if (typeof pagesCrawled === 'number') update.pages_crawled = pagesCrawled
    await supabase.from('audit_runs').update(update).eq('id', auditRunId)
  }

  try {
    const result = await runAudit({
      url: row.url,
      siteName: row.site_name ?? undefined,
      maxPages: row.max_pages,
      focusSegments: row.focus_segments ?? undefined,
      onProgress,
    })

    terminated = true
    await supabase
      .from('audit_runs')
      .update({
        audit_status: 'complete',
        status_detail: 'Audit complete',
        result: asJson(trimForStorage(result)),
        category_scores: asJson(result.category_scores),
        overall_score: result.overall_score,
        overall_grade: result.overall_grade,
        pages_crawled: result.pages_crawled,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', auditRunId)
  } catch (err) {
    console.error('[audit-worker] audit failed:', err)
    terminated = true
    await writeError(err instanceof Error ? err.message : 'Unknown error').catch(() => {})
  }
}
