// Server-only. Removes Design Studio storage objects nothing can reach any
// more (called by /api/cron/sweep-stuck-jobs, at most once an hour):
//   design/{sid}/renders/{uuid}-…   /design/render output — returned to the
//                                   browser as 1h signed URLs, never stored in
//                                   a row, so safe to drop after a day.
//   design/{sid}/attachments/{id}   chat attachments uploaded but never sent
//                                   (no design_chat_messages row references
//                                   the id), after a day.
//   design/{sid}/runs/{runId}/…     every render of a run that ended 'error'
//                                   or 'cancelled' over a week ago (the run is
//                                   stamped rendersSweptAt in its base snapshot
//                                   so it is not listed again), except a render
//                                   a design version uses as its thumbnail.
// renders/chat/** is NEVER touched here: chat previews are referenced by chat
// parts and reused as version screenshots.
//
// Bounded per invocation (a slice of sessions rotating hourly, a page cap per
// listing, a removal cap, a run cap) so a large bucket can never blow the cron's
// time budget; whatever is left is picked up by a later hour. Idempotent: a
// removed object is simply not listed again. Service-role client only (the
// bucket is private; nothing is ever made public). Fail-soft: never throws.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import { referencedAttachmentIds, versionScreenshotPathSet } from './chat-store'
import { removeDesignPaths } from './storage'

export const DESIGN_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000
export const DEAD_RUN_RENDER_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000
// Per-invocation bounds.
export const MAX_SESSIONS_PER_SWEEP = 40
export const MAX_REMOVALS_PER_SWEEP = 1000
export const MAX_DEAD_RUNS_PER_SWEEP = 10
const MAX_LIST_PAGES = 3
const PAGE = 1000
const HOUR_MS = 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ATTACHMENT_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/i
export const DEAD_RUN_STATUSES = ['error', 'cancelled'] as const

export type StorageEntry = { name: string; id: string | null; created_at?: string | null }

export type DeadRun = { id: string; sessionId: string; status: string; updatedAt: string; baseSnapshot: Json | null }

export type OrphanSweepDeps = {
  list: (prefix: string, offset: number, limit: number) => Promise<StorageEntry[]>
  remove: (paths: string[]) => Promise<void>
  // Every attachment id this session's chat messages reference.
  referencedAttachmentIds: (sessionId: string) => Promise<Set<string>>
  // Terminal error/cancelled runs last updated before `cutoffIso` whose
  // renders were not swept yet, oldest first.
  listDeadRuns: (cutoffIso: string, limit: number) => Promise<DeadRun[]>
  // Storage paths design versions of this session use as screenshots.
  versionPaths: (sessionId: string) => Promise<Set<string>>
  // Re-read right before deleting: true only while the run is STILL the dead
  // run we listed (same error/cancelled status, same updated_at). A Retry
  // moves it out of 'error' (and restamps it), so its renders are never
  // removed from under a resumed run.
  runStillDead: (run: DeadRun) => Promise<boolean>
  // Stamp the run's renders as swept (CAS on status + updated_at; false = the
  // run changed, e.g. a Retry, so it is left alone).
  markRunSwept: (run: DeadRun, at: string) => Promise<boolean>
}

export type OrphanSweepResult = { renders: number; attachments: number; runRenders: number }

// The cron runs every 5 minutes; storage listing is only worth doing hourly.
export function isStorageSweepSlot(now: number): boolean {
  return new Date(now).getUTCMinutes() < 5
}

async function listCapped(deps: OrphanSweepDeps, prefix: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const entries = await deps.list(prefix, page * PAGE, PAGE)
    out.push(...entries)
    if (entries.length < PAGE) break
  }
  return out
}

const isOld = (e: StorageEntry, cutoff: number): boolean => {
  const t = e.created_at ? Date.parse(e.created_at) : NaN
  return Number.isFinite(t) && t < cutoff
}

/**
 * This hour's slice of the session folders: MAX_SESSIONS_PER_SWEEP of them,
 * starting at an offset that advances every hour, so every session is visited
 * within ceil(n / MAX) hours whatever the bucket's size.
 */
export function sessionSlice<T>(sessions: T[], now: number): T[] {
  if (sessions.length <= MAX_SESSIONS_PER_SWEEP) return sessions
  const start = (Math.floor(now / HOUR_MS) * MAX_SESSIONS_PER_SWEEP) % sessions.length
  const out: T[] = []
  for (let i = 0; i < MAX_SESSIONS_PER_SWEEP; i++) out.push(sessions[(start + i) % sessions.length])
  return out
}

export async function sweepDesignStorageOrphans(deps: OrphanSweepDeps, now: number = Date.now()): Promise<OrphanSweepResult> {
  const result: OrphanSweepResult = { renders: 0, attachments: 0, runRenders: 0 }
  let budget = MAX_REMOVALS_PER_SWEEP
  const cutoff = now - DESIGN_ORPHAN_MIN_AGE_MS

  let sessions: string[] = []
  try {
    sessions = (await listCapped(deps, 'design'))
      .filter((e) => e.id === null && UUID_RE.test(e.name))
      .map((e) => e.name)
      .sort()
  } catch (err) {
    console.error('[sweep-stuck-jobs] design storage listing failed:', err)
  }

  for (const sid of sessionSlice(sessions, now)) {
    if (budget <= 0) break
    try {
      // Files directly under renders/ (folders such as chat/ have a null id).
      const renders = (await listCapped(deps, `design/${sid}/renders`))
        .filter((e) => e.id !== null && isOld(e, cutoff))
        .map((e) => `design/${sid}/renders/${e.name}`)
        .slice(0, budget)

      const oldAttachments = (await listCapped(deps, `design/${sid}/attachments`)).flatMap((e) => {
        const m = e.id !== null && isOld(e, cutoff) ? ATTACHMENT_RE.exec(e.name) : null
        return m ? [{ file: e.name, id: m[1].toLowerCase() }] : []
      })
      let attachments: string[] = []
      if (oldAttachments.length > 0 && budget - renders.length > 0) {
        // One query per session, not one per file.
        const referenced = await deps.referencedAttachmentIds(sid)
        attachments = oldAttachments
          .filter((a) => !referenced.has(a.id))
          .map((a) => `design/${sid}/attachments/${a.file}`)
          .slice(0, budget - renders.length)
      }

      const stale = [...renders, ...attachments]
      if (stale.length > 0) await deps.remove(stale)
      budget -= stale.length
      result.renders += renders.length
      result.attachments += attachments.length
    } catch (err) {
      console.error(`[sweep-stuck-jobs] design storage sweep failed for ${sid}:`, err)
    }
  }

  result.runRenders = await sweepDeadRunRenders(deps, now, budget)
  return result
}

/**
 * Renders of runs that failed or were cancelled over a week ago. Each run's
 * folder is emptied (minus version thumbnails) and the run stamped, so it is
 * never listed again; a Retry rewrites the base snapshot, which drops the
 * stamp. Returns the number of objects removed.
 */
export async function sweepDeadRunRenders(deps: OrphanSweepDeps, now: number, budget: number = MAX_REMOVALS_PER_SWEEP): Promise<number> {
  let removed = 0
  let runs: DeadRun[]
  try {
    runs = await deps.listDeadRuns(new Date(now - DEAD_RUN_RENDER_MIN_AGE_MS).toISOString(), MAX_DEAD_RUNS_PER_SWEEP)
  } catch (err) {
    console.error('[sweep-stuck-jobs] dead design run listing failed:', err)
    return 0
  }
  const at = new Date(now).toISOString()
  for (const run of runs) {
    if (budget - removed <= 0) break
    if (!UUID_RE.test(run.sessionId) || !UUID_RE.test(run.id)) continue
    try {
      const prefix = `design/${run.sessionId}/runs/${run.id}`
      const files = (await listCapped(deps, prefix)).filter((e) => e.id !== null).map((e) => `${prefix}/${e.name}`)
      const keep = files.length > 0 ? await deps.versionPaths(run.sessionId) : new Set<string>()
      const drop = files.filter((p) => !keep.has(p))
      const room = budget - removed
      if (drop.length > 0) {
        if (!(await deps.runStillDead(run))) continue
        await deps.remove(drop.slice(0, room))
      }
      removed += Math.min(drop.length, room)
      // Stamp only a fully emptied folder; a partial one is finished next time.
      if (drop.length <= room) await deps.markRunSwept(run, at)
    } catch (err) {
      console.error(`[sweep-stuck-jobs] dead run render sweep failed for ${run.id}:`, err)
    }
  }
  return removed
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function designStorageSweepDeps(supabase: SupabaseClient<Database>): OrphanSweepDeps {
  const bucket = supabase.storage.from('session-assets')
  return {
    list: async (prefix, offset, limit) => {
      const { data, error } = await bucket.list(prefix, { limit, offset })
      if (error) throw new Error(`storage list failed: ${error.message}`)
      return (data ?? []).map((e) => ({ name: e.name, id: e.id ?? null, created_at: e.created_at ?? null }))
    },
    remove: (paths) => removeDesignPaths(supabase, paths),
    referencedAttachmentIds: (sessionId) => referencedAttachmentIds(supabase, sessionId),
    listDeadRuns: async (cutoffIso, limit) => {
      const { data, error } = await supabase
        .from('design_runs')
        .select('id, session_id, status, updated_at, base_snapshot')
        .in('status', [...DEAD_RUN_STATUSES])
        .lt('updated_at', cutoffIso)
        .is('base_snapshot->>rendersSweptAt', null)
        .order('updated_at', { ascending: true })
        .limit(limit)
      if (error) throw new Error(`dead run listing failed: ${error.message}`)
      return (data ?? []).map((r) => ({ id: r.id, sessionId: r.session_id, status: r.status, updatedAt: r.updated_at, baseSnapshot: r.base_snapshot }))
    },
    versionPaths: (sessionId) => versionScreenshotPathSet(supabase, sessionId),
    runStillDead: async (run) => {
      const { data, error } = await supabase.from('design_runs').select('status, updated_at').eq('id', run.id).maybeSingle()
      if (error) throw new Error(`dead run re-read failed: ${error.message}`)
      return (
        !!data &&
        (DEAD_RUN_STATUSES as readonly string[]).includes(data.status) &&
        data.status === run.status &&
        data.updated_at === run.updatedAt
      )
    },
    markRunSwept: async (run, at) => {
      // updated_at is NOT bumped: the stamp is bookkeeping, not activity.
      const snapshot = { ...(isObject(run.baseSnapshot) ? run.baseSnapshot : {}), rendersSweptAt: at }
      const { data, error } = await supabase
        .from('design_runs')
        .update({ base_snapshot: asJson(snapshot) })
        .eq('id', run.id)
        .eq('status', run.status)
        .eq('updated_at', run.updatedAt)
        .select('id')
      if (error) throw new Error(`dead run stamp failed: ${error.message}`)
      return (data ?? []).length > 0
    },
  }
}
