// Server-only. Removes Design Studio storage objects nothing can reach any
// more (called by /api/cron/sweep-stuck-jobs, at most once an hour):
//   design/{sid}/renders/{uuid}-…   /design/render output — returned to the
//                                   browser as 1h signed URLs, never stored in
//                                   a row, so safe to drop after a day.
//   design/{sid}/attachments/{id}   chat attachments uploaded but never sent
//                                   (no design_chat_messages row references
//                                   the id), after a day.
// renders/chat/** is NEVER touched here: chat previews are referenced by chat
// parts and reused as version screenshots. Fail-soft: never throws.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isAttachmentReferenced } from './chat-store'
import { removeDesignPaths } from './storage'

export const DESIGN_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000
const PAGE = 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ATTACHMENT_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/i

export type StorageEntry = { name: string; id: string | null; created_at?: string | null }

export type OrphanSweepDeps = {
  list: (prefix: string, offset: number, limit: number) => Promise<StorageEntry[]>
  remove: (paths: string[]) => Promise<void>
  isAttachmentReferenced: (sessionId: string, attachmentId: string) => Promise<boolean>
}

export type OrphanSweepResult = { renders: number; attachments: number }

// The cron runs every 5 minutes; storage listing is only worth doing hourly.
export function isStorageSweepSlot(now: number): boolean {
  return new Date(now).getUTCMinutes() < 5
}

async function listAll(deps: OrphanSweepDeps, prefix: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await deps.list(prefix, offset, PAGE)
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

const isOld = (e: StorageEntry, cutoff: number): boolean => {
  const t = e.created_at ? Date.parse(e.created_at) : NaN
  return Number.isFinite(t) && t < cutoff
}

export async function sweepDesignStorageOrphans(deps: OrphanSweepDeps, now: number = Date.now()): Promise<OrphanSweepResult> {
  const result: OrphanSweepResult = { renders: 0, attachments: 0 }
  const cutoff = now - DESIGN_ORPHAN_MIN_AGE_MS
  let sessions: StorageEntry[]
  try {
    sessions = (await listAll(deps, 'design')).filter((e) => e.id === null && UUID_RE.test(e.name))
  } catch (err) {
    console.error('[sweep-stuck-jobs] design storage listing failed:', err)
    return result
  }

  for (const s of sessions) {
    const sid = s.name
    try {
      // Files directly under renders/ (folders such as chat/ have a null id).
      const renders = (await listAll(deps, `design/${sid}/renders`))
        .filter((e) => e.id !== null && isOld(e, cutoff))
        .map((e) => `design/${sid}/renders/${e.name}`)
      const stale: string[] = [...renders]

      for (const e of await listAll(deps, `design/${sid}/attachments`)) {
        const m = e.id !== null && isOld(e, cutoff) ? ATTACHMENT_RE.exec(e.name) : null
        if (m && !(await deps.isAttachmentReferenced(sid, m[1].toLowerCase()))) {
          stale.push(`design/${sid}/attachments/${e.name}`)
          result.attachments++
        }
      }
      for (let i = 0; i < stale.length; i += PAGE) await deps.remove(stale.slice(i, i + PAGE))
      result.renders += renders.length
    } catch (err) {
      console.error(`[sweep-stuck-jobs] design storage sweep failed for ${sid}:`, err)
    }
  }
  return result
}

export function designStorageSweepDeps(supabase: SupabaseClient<Database>): OrphanSweepDeps {
  const bucket = supabase.storage.from('session-assets')
  return {
    list: async (prefix, offset, limit) => {
      const { data, error } = await bucket.list(prefix, { limit, offset })
      if (error) throw new Error(`storage list failed: ${error.message}`)
      return (data ?? []).map((e) => ({ name: e.name, id: e.id ?? null, created_at: e.created_at ?? null }))
    },
    remove: (paths) => removeDesignPaths(supabase, paths),
    isAttachmentReferenced: (sessionId, attachmentId) => isAttachmentReferenced(supabase, sessionId, attachmentId),
  }
}
