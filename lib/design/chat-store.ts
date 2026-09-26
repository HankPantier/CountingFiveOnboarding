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

export async function clearChatHistory(db: Db, sessionId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await db.from('design_chat_messages').delete().eq('session_id', sessionId).select('*')
  if (error) throw chatError('clearChatHistory', error)
  return data ?? []
}
