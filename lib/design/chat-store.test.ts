import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { SID, makeChatRow } from './__fixtures__/rows'
import { clearChatHistory, insertChatMessage, isAttachmentReferenced, listChatMessages } from './chat-store'

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
  it('clears the session history and returns the deleted rows', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ data: [makeChatRow({ attachment_ids: [A1] })] }] })
    expect((await clearChatHistory(f.client, SID))[0].attachment_ids).toEqual([A1])
    expect(f.opsFor('design_chat_messages')).toEqual([['delete'], ['eq', 'session_id', SID], ['select', '*']])
  })
  it('throws on DB errors', async () => {
    const f = fakeSupabase({ design_chat_messages: [{ error: { message: 'boom' } }] })
    await expect(listChatMessages(f.client, SID)).rejects.toThrow(/listChatMessages/)
  })
})
