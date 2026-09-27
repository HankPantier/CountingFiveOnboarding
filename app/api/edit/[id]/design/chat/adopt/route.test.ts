import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'
import { fakeSupabase } from '@/lib/design/__fixtures__/fake-supabase'
import { __resetChatStateWarningForTests } from '@/lib/design/chat-store'

// The REAL chat store over a fake client, so the missing-table (pre-081) and
// present-table paths are both exercised end to end.
const m = vi.hoisted(() => ({ gate: vi.fn(), db: null as unknown }))
vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => m.db }))

import { DELETE } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const del = () => DELETE(new Request('http://x', { method: 'DELETE' }), params)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  __resetChatStateWarningForTests()
  m.gate.mockResolvedValue({ sessionId: SID })
})

describe('DELETE design/chat/adopt', () => {
  it('passes the admin gate response through and touches nothing', async () => {
    const f = fakeSupabase()
    m.db = f.client
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await del()).status).toBe(403)
    expect(f.queries).toHaveLength(0)
  })
  it('table present: clears the concept of the GATED session', async () => {
    const f = fakeSupabase({ design_chat_state: [{ data: null }] })
    m.db = f.client
    expect((await del()).status).toBe(200)
    const upsert = f.opsFor('design_chat_state').find((o) => o[0] === 'upsert')
    expect(upsert?.[1]).toMatchObject({ session_id: SID, adopted_concept_id: null })
  })
  it('table missing (081 not applied): still 200 — there is nothing to clear', async () => {
    m.db = fakeSupabase({ design_chat_state: [{ error: { code: 'PGRST205', message: 'not in schema cache' } }] }).client
    expect((await del()).status).toBe(200)
  })
  it('a real DB error is a 503, not a silent success', async () => {
    m.db = fakeSupabase({ design_chat_state: [{ error: { code: '57014', message: 'timeout' } }] }).client
    expect((await del()).status).toBe(503)
  })
})
