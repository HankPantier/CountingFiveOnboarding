// Server-only. Typed data access for design_locks (migration 085). Every read
// and write is scoped by session_id. Throws on DB errors (routes map them to
// internalError).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesInsert } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import { isCssTarget } from './css-targets'
import { parseLockSnapshot } from './lock-pins'
import { isLeverKey, type DesignLock, type DesignLockDto, type LockKind, type LockSnapshot } from './locks'

type Db = SupabaseClient<Database>
type LockRow = Tables<'design_locks'>

function lockError(context: string, error: { message: string } | null): Error {
  return new Error(`[design-locks] ${context}: ${error?.message ?? 'no data returned'}`)
}

// A row → a DesignLock; rows with an unknown key (a target retired from the
// vocabulary) are skipped rather than trusted.
export function lockFromRow(row: Pick<LockRow, 'kind' | 'key' | 'label' | 'snapshot'>): DesignLock | null {
  if (row.kind === 'area' && isCssTarget(row.key)) return { kind: 'area', key: row.key, label: row.label, snapshot: parseLockSnapshot(row.snapshot) }
  if (row.kind === 'lever' && isLeverKey(row.key)) return { kind: 'lever', key: row.key, label: row.label, snapshot: null }
  return null
}

export async function listLockRows(db: Db, sessionId: string): Promise<LockRow[]> {
  const { data, error } = await db.from('design_locks').select('*').eq('session_id', sessionId).order('created_at', { ascending: true })
  if (error) throw lockError('list', error)
  return data ?? []
}

export async function listLocks(db: Db, sessionId: string): Promise<DesignLock[]> {
  return (await listLockRows(db, sessionId)).map(lockFromRow).filter((l): l is DesignLock => l !== null)
}

export function lockDto(row: LockRow): DesignLockDto {
  return { kind: row.kind as LockKind, key: row.key, label: row.label, createdAt: row.created_at }
}

export type NewLock = { kind: LockKind; key: string; label: string; snapshot: LockSnapshot | null }

// Inserts the locks that don't exist yet (an existing lock keeps its original
// snapshot). Returns the keys actually inserted so a failed commit can undo them.
export async function insertLocks(db: Db, sessionId: string, locks: NewLock[], createdBy: string | null): Promise<NewLock[]> {
  if (locks.length === 0) return []
  const rows: TablesInsert<'design_locks'>[] = locks.map((l) => ({
    session_id: sessionId,
    kind: l.kind,
    key: l.key,
    label: l.label.slice(0, 120),
    snapshot: l.snapshot ? asJson(l.snapshot) : null,
    created_by: createdBy,
  }))
  const { data, error } = await db
    .from('design_locks')
    .upsert(rows, { onConflict: 'session_id,kind,key', ignoreDuplicates: true })
    .select('kind, key')
  if (error) throw lockError('insert', error)
  const inserted = new Set((data ?? []).map((r) => `${r.kind}:${r.key}`))
  return locks.filter((l) => inserted.has(`${l.kind}:${l.key}`))
}

export async function deleteLocks(db: Db, sessionId: string, keys: { kind: LockKind; key: string }[]): Promise<number> {
  let removed = 0
  for (const k of keys) {
    const { data, error } = await db.from('design_locks').delete().eq('session_id', sessionId).eq('kind', k.kind).eq('key', k.key).select('id')
    if (error) throw lockError('delete', error)
    removed += data?.length ?? 0
  }
  return removed
}

export async function updateLockSnapshot(db: Db, sessionId: string, key: string, snapshot: LockSnapshot): Promise<void> {
  const { error } = await db.from('design_locks').update({ snapshot: asJson(snapshot) }).eq('session_id', sessionId).eq('kind', 'area').eq('key', key)
  if (error) throw lockError('update snapshot', error)
}
