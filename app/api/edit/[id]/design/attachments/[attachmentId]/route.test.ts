import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'

const AID = '0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e'
const m = vi.hoisted(() => ({ gate: vi.fn(), referenced: vi.fn(), remove: vi.fn() }))
vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/chat-store', () => ({ isAttachmentReferenced: (...a: unknown[]) => m.referenced(...a) }))
vi.mock('@/lib/design/storage', async (orig) => ({ ...((await orig()) as object), removeDesignPaths: (...a: unknown[]) => m.remove(...a) }))

import { DELETE } from './route'

const call = (aid = AID) => DELETE(new Request('http://x/api', { method: 'DELETE' }), { params: Promise.resolve({ id: SID, attachmentId: aid }) })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, user: { isAdmin: true } })
  m.referenced.mockReset().mockResolvedValue(false)
  m.remove.mockReset().mockResolvedValue(undefined)
})

describe('DELETE /design/attachments/[attachmentId]', () => {
  it('passes the gate response through and 400s a bad id', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    m.gate.mockResolvedValue({ sessionId: SID, user: { isAdmin: true } })
    expect((await call('../x')).status).toBe(400)
  })
  it('refuses an attachment that is part of a sent message', async () => {
    m.referenced.mockResolvedValue(true)
    const res = await call()
    expect(res.status).toBe(409)
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('removes only this session’s object', async () => {
    expect((await call()).status).toBe(200)
    expect(m.referenced).toHaveBeenCalledWith({}, SID, AID)
    expect(m.remove).toHaveBeenCalledWith({}, [`design/${SID}/attachments/${AID}.webp`])
  })
})
