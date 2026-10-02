// Server-only. Creating / removing design locks — shared by the chat tools
// (lock_design / unlock_design, inside a turn's workspace) and the locks API
// (the chip ✕). Both take a lock on what is ON THE DRAFT now (`base`), write
// the rows, then commit through commitDesignVersion, which recomputes the pins
// from the rows. A failed commit undoes the row changes, so a lock never
// exists without its pins (and an unlock never leaves pins behind).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { DesignBundle } from './bundle'
import type { RepoThemeFiles } from './bundle-files'
import type { CommitVersionFn } from './chat-commit'
import type { CommitTarget, CommitVersionResult } from './commit-version'
import { snapshotFromBundle, withLockPins } from './lock-enforce'
import { deleteLocks, insertLocks, listLockRows, lockFromRow, type NewLock } from './lock-store'
import { defaultLockLabel, type DesignLock, type LockChange, type LockKind, type LockSnapshot } from './locks'

export type { LockChange }
import type { ThemeBlobShas } from './studio-types'
import { deriveChatVersionName } from './version-name'

type Db = SupabaseClient<Database>


export type LockBase = { bundle: DesignBundle; files: RepoThemeFiles; shas?: ThemeBlobShas }

export type LockChangeResult =
  | { ok: true; locks: DesignLock[]; changed: string[]; bundle: DesignBundle; appliedBlobs: ThemeBlobShas; versionId: string | null; versionNo: number | null }
  | { ok: false; status: 400 | 409 | 422; error: string }

export const SNAPSHOT_FAILED_ERROR = 'The current design could not be read, so nothing was locked. Refresh and try again.'
export const NOTHING_TO_CHANGE_ERROR = 'Name at least one area or lever.'

const current = (rows: Awaited<ReturnType<typeof listLockRows>>): DesignLock[] =>
  rows.map(lockFromRow).filter((l): l is DesignLock => l !== null)

export async function changeLocks(
  db: Db,
  args: { target: CommitTarget; base: LockBase; change: LockChange; commitVersion: CommitVersionFn }
): Promise<LockChangeResult> {
  const { target, base, change } = args
  const before = await listLockRows(db, target.sessionId)

  let inserted: NewLock[] = []
  let removedRows: typeof before = []
  if (change.op === 'lock') {
    if (change.areas.length + change.levers.length === 0) return { ok: false, status: 400, error: NOTHING_TO_CHANGE_ERROR }
    let snapshot: LockSnapshot | null = null
    if (change.areas.length > 0) {
      snapshot = snapshotFromBundle(base.bundle, base.files)
      if (!snapshot) return { ok: false, status: 409, error: SNAPSHOT_FAILED_ERROR }
    }
    const single = change.areas.length + change.levers.length === 1 ? change.label?.trim() : undefined
    const wanted: NewLock[] = [
      ...change.areas.map((key): NewLock => ({ kind: 'area', key, label: single || defaultLockLabel('area', key), snapshot })),
      ...change.levers.map((key): NewLock => ({ kind: 'lever', key, label: single || defaultLockLabel('lever', key), snapshot: null })),
    ]
    inserted = await insertLocks(db, target.sessionId, wanted, target.adminId)
  } else {
    if (change.keys.length === 0) return { ok: false, status: 400, error: NOTHING_TO_CHANGE_ERROR }
    removedRows = before.filter((r) => change.keys.some((k) => k.kind === r.kind && k.key === r.key))
    await deleteLocks(db, target.sessionId, removedRows.map((r) => ({ kind: r.kind as LockKind, key: r.key })))
  }

  const changed = change.op === 'lock' ? inserted.map((l) => l.label) : removedRows.map((r) => r.label)
  const after = await listLockRows(db, target.sessionId)
  const locks = current(after)
  if (changed.length === 0) {
    return { ok: true, locks, changed, bundle: base.bundle, appliedBlobs: base.shas ?? {}, versionId: null, versionNo: null }
  }

  const summary = `${change.op === 'lock' ? 'Locked' : 'Unlocked'} ${changed.join(', ')}`.slice(0, 300)
  let result: CommitVersionResult
  try {
    result = await args.commitVersion({
      target,
      bundle: { ...base.bundle, name: deriveChatVersionName(summary) },
      source: 'chat',
      removeLegacy: false,
      syncMbp: false,
      summary,
      commitMessage: `Design Studio: ${summary} (${target.adminEmail ?? 'admin'})`,
      ...(base.shas ? { expectedShas: base.shas } : {}),
      skipIfUnchanged: true,
    })
  } catch (err) {
    await undo(db, target, inserted, removedRows)
    throw err
  }
  if (!result.ok) {
    await undo(db, target, inserted, removedRows)
    return { ok: false, status: result.status, error: result.error }
  }
  return {
    ok: true,
    locks,
    changed,
    bundle: withLockPins(base.bundle, locks),
    appliedBlobs: result.appliedBlobs,
    versionId: result.version?.id ?? null,
    versionNo: result.version?.version_no ?? null,
  }
}

async function undo(db: Db, target: CommitTarget, inserted: NewLock[], removed: Awaited<ReturnType<typeof listLockRows>>): Promise<void> {
  try {
    if (inserted.length > 0) await deleteLocks(db, target.sessionId, inserted.map((l) => ({ kind: l.kind, key: l.key })))
    // One insert per row so each restored lock keeps its own creator.
    for (const r of removed) {
      const lock = lockFromRow(r)
      await insertLocks(db, target.sessionId, [{ kind: r.kind as LockKind, key: r.key, label: r.label, snapshot: lock?.kind === 'area' ? lock.snapshot : null }], r.created_by)
    }
  } catch (err) {
    console.error('[design-locks] could not undo a lock change after its commit failed', err)
  }
}
