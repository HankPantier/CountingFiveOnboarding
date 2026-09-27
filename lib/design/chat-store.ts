// Server-only. design_chat_messages access (migration 078). Every read/write
// is scoped by session_id. Throws on DB errors (routes map them to
// internalError); never returns raw DB text to the client itself.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import type { ChatMessageRow } from './chat-history'
import { HISTORY_LOAD_LIMIT } from './chat-types'

type Db = SupabaseClient<Database>
const CONTENT_MAX = 20_000

function chatError(context: string, error: { message: string } | null): Error {
  return new Error(`[design-chat-store] ${context}: ${error?.message ?? 'no data returned'}`)
}

export async function listChatMessages(db: Db, sessionId: string, limit = HISTORY_LOAD_LIMIT): Promise<ChatMessageRow[]> {
  const { data, error } = await db
    .from('design_chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw chatError('listChatMessages', error)
  return [...(data ?? [])].reverse()
}

export type NewChatMessage = {
  id?: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  parts: unknown[]
  attachmentIds?: string[]
  versionId?: string | null
  createdBy: string | null
}

export async function insertChatMessage(db: Db, m: NewChatMessage): Promise<ChatMessageRow> {
  const row: TablesInsert<'design_chat_messages'> = {
    session_id: m.sessionId,
    role: m.role,
    content: m.content.slice(0, CONTENT_MAX),
    parts: asJson(m.parts),
    attachment_ids: m.attachmentIds ?? [],
    version_id: m.versionId ?? null,
    created_by: m.createdBy,
  }
  if (m.id) row.id = m.id
  const { data, error } = await db.from('design_chat_messages').insert(row).select('*').single()
  if (error || !data) throw chatError('insertChatMessage', error)
  return data
}

export async function isAttachmentReferenced(db: Db, sessionId: string, attachmentId: string): Promise<boolean> {
  const { data, error } = await db
    .from('design_chat_messages')
    .select('id')
    .eq('session_id', sessionId)
    .contains('attachment_ids', [attachmentId])
    .limit(1)
  if (error) throw chatError('isAttachmentReferenced', error)
  return (data ?? []).length > 0
}

// Every attachment id this session's messages reference — one query, for the
// hourly orphan sweep (lib/design/storage-sweep.ts).
export async function referencedAttachmentIds(db: Db, sessionId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('design_chat_messages')
    .select('attachment_ids')
    .eq('session_id', sessionId)
  if (error) throw chatError('referencedAttachmentIds', error)
  const out = new Set<string>()
  for (const row of data ?? []) for (const id of row.attachment_ids) out.add(id.toLowerCase())
  return out
}

// Every storage path a design version of this session uses as a screenshot
// (chat versions reuse their chat preview renders), so clearing the chat
// never deletes a version's thumbnail.
export async function versionScreenshotPathSet(db: Db, sessionId: string): Promise<Set<string>> {
  const { data, error } = await db.from('design_versions').select('screenshots').eq('session_id', sessionId)
  if (error) throw chatError('versionScreenshotPathSet', error)
  const out = new Set<string>()
  for (const row of data ?? []) {
    if (!Array.isArray(row.screenshots)) continue
    for (const s of row.screenshots) {
      if (s && typeof s === 'object' && !Array.isArray(s) && typeof s.path === 'string') out.add(s.path)
    }
  }
  return out
}

// ---- Chat state (migration 081): the "Fix in chat" concept, kept only so
// the chip survives a reload (the client re-sends the id on every turn, so no
// turn depends on this table). Fail-soft: before 081 is applied the table is
// missing — reads return null, writes count as done, and that is warned ONCE
// per process, not on every GET or turn. Other DB errors warn each time.

// PostgREST "table not in the schema cache" / Postgres "undefined_table".
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])
let warnedMissingChatState = false

export function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true
  return /design_chat_state/.test(error.message ?? '') && /(does not exist|schema cache)/i.test(error.message ?? '')
}

// True when the error is only "081 not applied yet" (warned once).
function chatStateMissing(error: { code?: string; message?: string }): boolean {
  if (!isMissingTableError(error)) return false
  if (!warnedMissingChatState) {
    warnedMissingChatState = true
    console.warn('[design-chat-store] design_chat_state is missing (apply migration 081) — the "Fix in chat" chip will not survive a reload.')
  }
  return true
}

/** Test hook: forget the once-per-process warning. */
export function __resetChatStateWarningForTests(): void {
  warnedMissingChatState = false
}

export async function getAdoptedConceptId(db: Db, sessionId: string): Promise<string | null> {
  const { data, error } = await db.from('design_chat_state').select('adopted_concept_id').eq('session_id', sessionId).maybeSingle()
  if (error) {
    if (!chatStateMissing(error)) console.warn('[design-chat-store] adopted concept not read:', error.message)
    return null
  }
  return data?.adopted_concept_id ?? null
}

/**
 * Persist (or, with null, clear) the chat's adopted concept. Idempotent.
 * Returns false only on a real DB error; a missing table (081 not applied)
 * counts as done — there is nothing to persist to or clear.
 */
export async function setAdoptedConceptId(db: Db, sessionId: string, conceptId: string | null): Promise<boolean> {
  const { error } = await db
    .from('design_chat_state')
    .upsert({ session_id: sessionId, adopted_concept_id: conceptId, updated_at: new Date().toISOString() }, { onConflict: 'session_id' })
  if (!error) return true
  if (chatStateMissing(error)) return true
  console.warn('[design-chat-store] adopted concept not saved:', error.message)
  return false
}

/** Clear the adopted concept only while it is still `conceptId` (fail-soft). */
export async function clearAdoptedConceptIf(db: Db, sessionId: string, conceptId: string): Promise<void> {
  const { error } = await db
    .from('design_chat_state')
    .update({ adopted_concept_id: null, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('adopted_concept_id', conceptId)
  if (error && !chatStateMissing(error)) console.warn('[design-chat-store] adopted concept not cleared:', error.message)
}

export async function clearChatHistory(db: Db, sessionId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await db.from('design_chat_messages').delete().eq('session_id', sessionId).select('*')
  if (error) throw chatError('clearChatHistory', error)
  return data ?? []
}
