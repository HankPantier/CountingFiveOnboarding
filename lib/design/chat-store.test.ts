import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { SID, makeChatRow } from './__fixtures__/rows'
import {
  clearAdoptedConceptIf,
  clearChatHistory,
  getAdoptedConceptId,
  insertChatMessage,
  isAttachmentReferenced,
  listChatMessages,
  referencedAttachmentIds,
  setAdoptedConceptId,
  __resetChatStateWarningForTests,
} from './chat-store'

const A1 = '0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e'

describe('chat store', () => {
  it('lists the newest N messages of the session, returned oldest first', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ data: [makeChatRow({ id: 'b', created_at: '2026-09-25T12:01:00Z' }), makeChatRow({ id: 'a' })] }] })
    expect((await listChatMessages(f.client, SID, 10)).map((r) => r.id)).toEqual(['a', 'b'])
    expect(f.opsFor('design_chat_messages')).toEqual([
      ['select', '*'],
      ['eq', 'session_id', SID],
      ['order', 'created_at', { ascending: false }],
      ['limit', 10],
    ])
  })
  it('inserts a message with an explicit id, trimmed content and jsonb parts', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ data: makeChatRow() }] })
    await insertChatMessage(f.client, { id: 'x', sessionId: SID, role: 'assistant', content: 'y'.repeat(30_000), parts: [{ type: 'text', text: 'y' }], versionId: 'ver-2', createdBy: 'admin-1' })
    const row = f.opsFor('design_chat_messages')[0][1] as Record<string, unknown>
    expect(row).toMatchObject({ id: 'x', session_id: SID, role: 'assistant', attachment_ids: [], version_id: 'ver-2', created_by: 'admin-1' })
    expect((row.content as string).length).toBe(20_000)
  })
  it('knows whether an attachment was sent (session-scoped)', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ data: [{ id: 'm' }] }, { data: [] }] })
    expect(await isAttachmentReferenced(f.client, SID, A1)).toBe(true)
    expect(f.opsFor('design_chat_messages')).toContainEqual(['contains', 'attachment_ids', [A1]])
    expect(f.opsFor('design_chat_messages')).toContainEqual(['eq', 'session_id', SID])
    expect(await isAttachmentReferenced(f.client, SID, A1)).toBe(false)
  })
  it('collects every attachment id the session references in one query (lower-cased)', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ data: [{ attachment_ids: [A1.toUpperCase()] }, { attachment_ids: [] }] }] })
    expect(await referencedAttachmentIds(f.client, SID)).toEqual(new Set([A1]))
    expect(f.opsFor('design_chat_messages')).toContainEqual(['eq', 'session_id', SID])
  })
  it('clears the session history and returns the deleted rows', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ data: [makeChatRow({ attachment_ids: [A1] })] }] })
    expect((await clearChatHistory(f.client, SID))[0].attachment_ids).toEqual([A1])
    expect(f.opsFor('design_chat_messages')).toEqual([['delete'], ['eq', 'session_id', SID], ['select', '*']])
  })
  it('reads, persists and conditionally clears the adopted concept (session-scoped)', async () => {
    const C = '2d8b3e4f-7a6c-4a0d-9e3f-4b5c6d7e8f90'
    const f = fakeSupabase({ design_chat_state: [{ data: { adopted_concept_id: C } }, { data: null }, { data: null }] })
    expect(await getAdoptedConceptId(f.client, SID)).toBe(C)
    expect(f.opsFor('design_chat_state')).toContainEqual(['eq', 'session_id', SID])
    expect(await setAdoptedConceptId(f.client, SID, C)).toBe(true)
    const upsert = f.opsFor('design_chat_state', 1).find((o) => o[0] === 'upsert')
    expect(upsert?.[1]).toMatchObject({ session_id: SID, adopted_concept_id: C })
    await clearAdoptedConceptIf(f.client, SID, C)
    expect(f.opsFor('design_chat_state', 2)).toContainEqual(['eq', 'adopted_concept_id', C])
    expect(f.opsFor('design_chat_state', 2)).toContainEqual(['eq', 'session_id', SID])
  })
  it('before migration 081 (table missing): reads are null, writes/clears count as done, warned ONCE per process', async () => {
    __resetChatStateWarningForTests()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.design_chat_state' in the schema cache" }
    const f = fakeSupabase({ design_chat_state: [{ error: missing }, { error: missing }, { error: { code: '42P01', message: 'relation "design_chat_state" does not exist' } }, { error: missing }] })
    expect(await getAdoptedConceptId(f.client, SID)).toBeNull()
    expect(await setAdoptedConceptId(f.client, SID, null)).toBe(true)
    expect(await setAdoptedConceptId(f.client, SID, '2d8b3e4f-7a6c-4a0d-9e3f-4b5c6d7e8f90')).toBe(true)
    await clearAdoptedConceptIf(f.client, SID, '2d8b3e4f-7a6c-4a0d-9e3f-4b5c6d7e8f90')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/081/)
    warn.mockRestore()
  })
  it('a real DB error (table present) is a failed write and warns each time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fakeSupabase({ design_chat_state: [{ error: { code: '57014', message: 'timeout' } }, { error: { code: '57014', message: 'timeout' } }] })
    expect(await getAdoptedConceptId(f.client, SID)).toBeNull()
    expect(await setAdoptedConceptId(f.client, SID, null)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
  it('throws on DB errors', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ error: { message: 'boom' } }] })
    await expect(listChatMessages(f.client, SID)).rejects.toThrow(/listChatMessages/)
  })
})
