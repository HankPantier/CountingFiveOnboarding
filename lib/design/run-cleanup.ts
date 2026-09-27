// Server-only. Render cleanup when concepts leave a run (a Retry deletes the
// failed positions so they are designed again). Their renders under
// design/{sid}/runs/{runId}/ were referenced only by the deleted rows, so they
// would orphan: removed here, best-effort, except any a design version uses as
// its thumbnail. Service-role client only; the bucket stays private.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/database'
import { versionScreenshotPathSet } from './chat-store'
import { parseConceptReview } from './review'
import { parseScreenshots } from './screenshots'
import { removeDesignPaths } from './storage'

type Db = SupabaseClient<Database>
type ConceptLike = Pick<Tables<'design_concepts'>, 'screenshots' | 'critique'>

/** Every render path a concept row references (current, first-render and best sets). */
export function conceptRenderPaths(rows: ConceptLike[]): string[] {
  const out = new Set<string>()
  for (const row of rows) {
    for (const s of parseScreenshots(row.screenshots)) out.add(s.path)
    const review = parseConceptReview(row.critique)
    for (const s of review?.initialScreenshots ?? []) out.add(s.path)
    for (const s of review?.best?.screenshots ?? []) out.add(s.path)
  }
  return [...out]
}

/**
 * Remove the renders of concepts being deleted from `runId`. Only paths inside
 * that run's folder are touched. Never throws; returns how many were removed.
 */
export async function removeRetiredConceptRenders(db: Db, sessionId: string, runId: string, rows: ConceptLike[]): Promise<number> {
  const prefix = `design/${sessionId}/runs/${runId}/`
  const candidates = conceptRenderPaths(rows).filter((p) => p.startsWith(prefix) && !p.includes('..'))
  if (candidates.length === 0) return 0
  try {
    const keep = await versionScreenshotPathSet(db, sessionId)
    const drop = candidates.filter((p) => !keep.has(p))
    if (drop.length > 0) await removeDesignPaths(db, drop)
    return drop.length
  } catch (err) {
    // The hourly sweep (storage-sweep.ts) reclaims the folder once the run is
    // a week-old failure; nothing else depends on this succeeding.
    console.warn('[design-run] could not delete the retried concepts’ renders', err)
    return 0
  }
}
